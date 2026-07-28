// ============================================================
// BuildingDocument GeoJSON 导出 — v2.1.0
//
// 坐标系：local_cartesian_mm，不伪造 EPSG
// ============================================================

import type { BuildingDocument } from './buildingTypes.ts';

interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: unknown;
  };
  properties: Record<string, unknown>;
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  coordinate_reference: string;
  metadata: {
    building_id: string;
    schema_version: string;
    revision: number;
    generated_at: string;
    units: string;
  };
  features: GeoJsonFeature[];
}

/**
 * 导出 BuildingDocument 为 GeoJSON FeatureCollection
 */
export function exportBuildingToGeoJson(
  document: BuildingDocument,
): GeoJsonFeatureCollection {
  const features: GeoJsonFeature[] = [];
  const verts = document.vertices;

  // 墙体中心线 → LineString
  for (const [wallId, wall] of Object.entries(document.walls)) {
    const sv = verts[wall.start_vertex_id];
    const ev = verts[wall.end_vertex_id];
    if (!sv || !ev) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [sv.x_mm, sv.y_mm],
          [ev.x_mm, ev.y_mm],
        ],
      },
      properties: {
        building_id: document.building_id,
        entity_type: 'wall',
        entity_id: wallId,
        wall_type: wall.wall_type,
        thickness_mm: wall.thickness_mm,
        height_mm: wall.height_mm,
        material_type: wall.material_type,
        revision: document.metadata?.revision ?? 0,
      },
    });
  }

  // 房间 → Polygon
  for (const [faceId, face] of Object.entries(document.faces)) {
    if (face.boundary_vertex_ids.length < 3) continue;
    const coords = face.boundary_vertex_ids.map((vid) => {
      const v = verts[vid];
      return v ? [v.x_mm, v.y_mm] : [0, 0];
    });

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coords],
      },
      properties: {
        building_id: document.building_id,
        entity_type: 'face',
        entity_id: faceId,
        function_code: face.function_code,
        display_name: face.display_name,
        area_mm2: face.area_mm2,
        heated: face.heated ?? false,
        occupied: face.occupied ?? false,
        revision: document.metadata?.revision ?? 0,
      },
    });
  }

  // 院落 → Polygon
  for (const [regionId, region] of Object.entries(document.outside_regions)) {
    if (region.boundary_vertex_ids.length < 3) continue;
    const coords = region.boundary_vertex_ids.map((vid) => {
      const v = verts[vid];
      return v ? [v.x_mm, v.y_mm] : [0, 0];
    });

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coords],
      },
      properties: {
        building_id: document.building_id,
        entity_type: 'outside_region',
        entity_id: regionId,
        region_type: region.region_type,
        revision: document.metadata?.revision ?? 0,
      },
    });
  }

  // 门窗 → Point (中心点)
  for (const [elementId, element] of Object.entries(document.wall_elements)) {
    const hostWall = document.walls[element.host_wall_id];
    if (!hostWall) continue;
    const sv = verts[hostWall.start_vertex_id];
    const ev = verts[hostWall.end_vertex_id];
    if (!sv || !ev) continue;

    const dx = ev.x_mm - sv.x_mm;
    const dy = ev.y_mm - sv.y_mm;
    const wallLen = Math.hypot(dx, dy);
    if (wallLen === 0) continue;

    const ux = dx / wallLen;
    const uy = dy / wallLen;
    const cx = sv.x_mm + ux * (element.offset_from_start_mm + element.width_mm / 2);
    const cy = sv.y_mm + uy * (element.offset_from_start_mm + element.width_mm / 2);

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [Math.round(cx), Math.round(cy)],
      },
      properties: {
        building_id: document.building_id,
        entity_type: 'wall_element',
        entity_id: elementId,
        element_type: element.element_type,
        host_wall_id: element.host_wall_id,
        width_mm: element.width_mm,
        height_mm: element.height_mm,
        revision: document.metadata?.revision ?? 0,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    coordinate_reference: 'local_cartesian_mm',
    metadata: {
      building_id: document.building_id,
      schema_version: document.schema_version,
      revision: document.metadata?.revision ?? 0,
      generated_at: new Date().toISOString(),
      units: 'mm',
    },
    features,
  };
}
