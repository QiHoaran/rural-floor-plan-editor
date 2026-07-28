// ============================================================
// GeoJSON 导出 — 将 PlanDocument 导出为 GeoJSON
//
// 注意：坐标系为局部笛卡尔坐标（cm），不是 WGS84
// GeoJSON 中通过 metadata 字段说明坐标类型
// ============================================================

import type { PlanDocument } from './planTypes.ts';

interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: any;
  };
  properties: Record<string, any>;
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  metadata: {
    coordinate_type: string;
    unit: string;
    origin: string;
    generated_at: string;
    plan_id: string;
  };
  features: GeoJsonFeature[];
}

/**
 * 导出为 GeoJSON FeatureCollection
 *
 * 映射规则：
 * - wall centerline → LineString
 * - wall polygon → Polygon (可选)
 * - room → Polygon
 * - door/window → LineString
 */
export function exportToGeoJson(doc: PlanDocument): GeoJsonFeatureCollection {
  const features: GeoJsonFeature[] = [];
  const verts = doc.vertices;

  // 墙体中心线 → LineString
  for (const [wallId, wall] of Object.entries(doc.walls)) {
    const sv = verts[wall.start_vertex_id];
    const ev = verts[wall.end_vertex_id];
    if (!sv || !ev) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [sv.x_cm, sv.y_cm],
          [ev.x_cm, ev.y_cm],
        ],
      },
      properties: {
        entity_type: 'wall',
        wall_id: wallId,
        wall_type: wall.wall_type,
        thickness_cm: wall.thickness_cm,
        height_cm: wall.height_cm,
        material_type: wall.material_type,
        length_cm: Math.round(Math.sqrt(
          (ev.x_cm - sv.x_cm) ** 2 + (ev.y_cm - sv.y_cm) ** 2,
        )),
        review_status: wall.review_status,
      },
    });
  }

  // 门窗 → LineString
  for (const [opId, opening] of Object.entries(doc.openings)) {
    const wall = doc.walls[opening.host_wall_id];
    if (!wall) continue;
    const sv = verts[wall.start_vertex_id];
    const ev = verts[wall.end_vertex_id];
    if (!sv || !ev) continue;

    const dx = ev.x_cm - sv.x_cm;
    const dy = ev.y_cm - sv.y_cm;
    const wallLen = Math.sqrt(dx * dx + dy * dy);
    if (wallLen === 0) continue;

    const ux = dx / wallLen;
    const uy = dy / wallLen;
    const halfW = opening.width_cm / 2;

    const cx = sv.x_cm + ux * opening.offset_from_start_cm;
    const cy = sv.y_cm + uy * opening.offset_from_start_cm;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [cx - ux * halfW, cy - uy * halfW],
          [cx + ux * halfW, cy + uy * halfW],
        ],
      },
      properties: {
        entity_type: 'opening',
        opening_id: opId,
        opening_type: opening.opening_type,
        host_wall_id: opening.host_wall_id,
        width_cm: opening.width_cm,
        height_cm: opening.height_cm,
        sill_height_cm: opening.sill_height_cm,
        review_status: opening.review_status,
      },
    });
  }

  // 房间 → Polygon
  for (const [spaceId, space] of Object.entries(doc.spaces)) {
    if (!space.generated_polygon || space.generated_polygon.length === 0) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: space.generated_polygon.map((ring) =>
          ring.map(([x, y]) => [x, y]),
        ),
      },
      properties: {
        entity_type: 'space',
        space_id: spaceId,
        room_type: space.room_type,
        local_name: space.local_name,
        source: space.source,
        confidence: space.confidence,
        heated: space.heated,
        review_status: space.review_status,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    metadata: {
      coordinate_type: 'local_cartesian',
      unit: 'cm',
      origin: 'bottom_left',
      generated_at: new Date().toISOString(),
      plan_id: doc.plan_id,
    },
    features,
  };
}

/**
 * 下载 GeoJSON 文件
 */
export function downloadGeoJson(doc: PlanDocument): void {
  const geojson = exportToGeoJson(doc);
  const json = JSON.stringify(geojson, null, 2);
  const blob = new Blob([json], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.plan_id}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}
