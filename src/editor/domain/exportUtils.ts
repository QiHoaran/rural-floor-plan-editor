// ============================================================
// 统一导出工具 — v2.1.0
//
// 提供 Building JSON、空间图和 GeoJSON 下载
// ============================================================

import type { BuildingDocument } from './buildingTypes.ts';
import { generateSpatialGraph } from './spatialGraph.ts';
import { exportBuildingToGeoJson } from './buildingGeoJson.ts';
import { computeBuildingStatistics } from './buildingStatistics.ts';
import { validateBuildingDocumentFull } from './buildingValidation.ts';

/**
 * 准备导出文档：更新统计、校验、时间戳
 */
export function prepareExportDocument(
  document: BuildingDocument,
): BuildingDocument {
  const now = new Date().toISOString();
  return {
    ...document,
    metadata: {
      ...document.metadata,
      updated_at: now,
    },
    statistics: computeBuildingStatistics(document),
    structured_validation: validateBuildingDocumentFull(document),
  };
}

/**
 * 下载 Building JSON
 */
export function downloadBuildingJson(document: BuildingDocument): void {
  const prepared = prepareExportDocument(document);
  const json = JSON.stringify(prepared, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(
    blob,
    `${document.building_id}_building_v${document.metadata?.revision ?? 0}.json`,
  );
}

/**
 * 下载空间图 JSON
 */
export function downloadSpatialGraph(document: BuildingDocument): void {
  const graph = generateSpatialGraph(document);
  const json = JSON.stringify(graph, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(
    blob,
    `${document.building_id}_spatial_graph_v${document.metadata?.revision ?? 0}.json`,
  );
}

/**
 * 下载 GeoJSON
 */
export function downloadGeoJson(document: BuildingDocument): void {
  const geojson = exportBuildingToGeoJson(document);
  const json = JSON.stringify(geojson, null, 2);
  const blob = new Blob([json], { type: 'application/geo+json' });
  downloadBlob(
    blob,
    `${document.building_id}_building_v${document.metadata?.revision ?? 0}.geojson`,
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
