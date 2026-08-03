// ============================================================
// 空间图导出 — 基于 BuildingDocument 的连通关系图
// v2.1.0
// ============================================================

import type { BuildingDocument } from './buildingTypes.ts';
export interface SpatialGraphNode {
  id: string;
  type: 'room' | 'courtyard' | 'outside';
  function_code: string | null;
  area_m2: number | null;
  centroid_mm: [number, number] | null;
}

export interface SpatialGraphEdge {
  source: string;
  target: string;
  relation: 'adjacent' | 'door' | 'passage' | 'window';
  people: boolean;
  air: boolean;
  light: boolean;
  wall_element_id?: string;
}

export interface SpatialGraph {
  building_id: string;
  revision: number;
  generated_at: string;
  nodes: SpatialGraphNode[];
  edges: SpatialGraphEdge[];
}

/**
 * 计算面片的质心
 */
function polygonCentroid(
  boundaryVertexIds: string[],
  document: BuildingDocument,
): [number, number] {
  const points = boundaryVertexIds
    .map((id) => document.vertices[id])
    .filter(Boolean);

  if (points.length === 0) return [0, 0];

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    const cross =
      points[index].x_mm * points[next].y_mm -
      points[next].x_mm * points[index].y_mm;
    twiceArea += cross;
    cx += (points[index].x_mm + points[next].x_mm) * cross;
    cy += (points[index].y_mm + points[next].y_mm) * cross;
  }
  if (twiceArea === 0) {
    const sums = points.reduce(
      (acc, point) => [acc[0] + point.x_mm, acc[1] + point.y_mm],
      [0, 0],
    );
    return [
      Math.round(sums[0] / points.length),
      Math.round(sums[1] / points.length),
    ];
  }
  return [
    Math.round(cx / (3 * twiceArea)),
    Math.round(cy / (3 * twiceArea)),
  ];
}

/**
 * 从 relation 推断边类型
 */
function edgeRelation(
  relation: BuildingDocument['relations'][number],
): SpatialGraphEdge['relation'] {
  if (relation.relation_type !== 'opening' && relation.relation_type !== 'connection') {
    return 'adjacent';
  }
  // 通过 channels 推断边类型
  if (relation.channels.people && relation.channels.light) return 'door';
  if (relation.channels.light && !relation.channels.people) return 'window';
  if (relation.channels.people && !relation.channels.light) return 'passage';
  return 'adjacent';
}

/**
 * 生成空间图
 */
export function generateSpatialGraph(
  document: BuildingDocument,
): SpatialGraph {
  const nodes: SpatialGraphNode[] = [
    {
      id: 'outside',
      type: 'outside',
      function_code: null,
      area_m2: null,
      centroid_mm: null,
    },
  ];

  // 室内房间节点
  for (const [faceId, face] of Object.entries(document.faces)) {
    nodes.push({
      id: faceId,
      type: 'room',
      function_code: face.function_code,
      area_m2: Math.round((face.area_mm2 / 1_000_000) * 100) / 100,
      centroid_mm: polygonCentroid(face.boundary_vertex_ids, document),
    });
  }

  // 院落节点
  for (const [regionId, region] of Object.entries(document.outside_regions)) {
    const area = computeRegionArea(region.boundary_vertex_ids, document);
    nodes.push({
      id: regionId,
      type: 'courtyard',
      function_code: 'courtyard',
      area_m2: Math.round((area / 1_000_000) * 100) / 100,
      centroid_mm: polygonCentroid(region.boundary_vertex_ids, document),
    });
  }

  // 边
  const edges: SpatialGraphEdge[] = [];
  const edgeSet = new Set<string>();

  for (const relation of document.relations) {
    const fromId = relation.from_face_id;
    const toId = relation.to.kind === 'outside' ? 'outside' : relation.to.face_id;

    // 映射 outside 到具体院落
    const targets = [toId];

    for (const target of targets) {
      const edgeKey = [
        ...[fromId, target].sort(),
        relation.wall_element_id,
      ].join('|');
      if (edgeSet.has(edgeKey)) continue;
      edgeSet.add(edgeKey);

      edges.push({
        source: fromId,
        target,
        relation: edgeRelation(relation),
        people: relation.channels.people,
        air: relation.channels.air,
        light: relation.channels.light,
        wall_element_id: relation.wall_element_id,
      });
    }
  }

  return {
    building_id: document.building_id,
    revision: document.metadata?.revision ?? 0,
    generated_at: new Date().toISOString(),
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    ),
  };
}

function computeRegionArea(
  boundaryVertexIds: string[],
  document: BuildingDocument,
): number {
  const points = boundaryVertexIds
    .map((id) => document.vertices[id])
    .filter(Boolean);
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x_mm * points[j].y_mm;
    area -= points[j].x_mm * points[i].y_mm;
  }
  return Math.abs(area) / 2;
}

