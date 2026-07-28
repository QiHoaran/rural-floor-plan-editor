// ============================================================
// 图层渲染器 — 将 Store 中的领域数据渲染为 Leaflet 图层
// ============================================================

import L from 'leaflet';
import type { PlanDocument } from '@/editor/domain/planTypes.ts';
import { WALL_TYPE_COLORS, COLORS } from '@/editor/domain/constants.ts';
import { calculateOpeningPosition } from '@/editor/domain/openingGeometry.ts';
import { generateSimpleWallPolygon } from '@/editor/domain/wallGeometry.ts';
import { domainXYToLeafletLatLng } from '@/editor/leaflet/coordinateAdapter.ts';

/**
 * 墙体图层组
 */
export interface WallLayers {
  centerlines: L.LayerGroup;
  wallFaces: L.LayerGroup;
  vertices: L.LayerGroup;
  openings: L.LayerGroup;
  spaces: L.LayerGroup;
  drawingPreview: L.LayerGroup;
  all: L.LayerGroup;
}

/**
 * 创建空的图层组
 */
export function createWallLayers(): WallLayers {
  const centerlines = L.layerGroup();
  const wallFaces = L.layerGroup();
  const vertices = L.layerGroup();
  const openings = L.layerGroup();
  const spaces = L.layerGroup();
  const drawingPreview = L.layerGroup();
  const all = L.layerGroup([
    wallFaces as any,
    centerlines as any,
    vertices as any,
    openings as any,
    spaces as any,
    drawingPreview as any,
  ]);

  return { centerlines, wallFaces, vertices, openings, spaces, drawingPreview, all };
}

/**
 * 渲染所有墙体中心线
 */
export function renderWalls(
  doc: PlanDocument,
  centerlinesGroup: L.LayerGroup,
  wallFacesGroup: L.LayerGroup,
  selectedWallId: string | null,
  hoveredWallId: string | null,
): void {
  centerlinesGroup.clearLayers();

  for (const [wallId, wall] of Object.entries(doc.walls)) {
    const startV = doc.vertices[wall.start_vertex_id];
    const endV = doc.vertices[wall.end_vertex_id];
    if (!startV || !endV) continue;

    const startLatLng = domainXYToLeafletLatLng(startV.x_cm, startV.y_cm);
    const endLatLng = domainXYToLeafletLatLng(endV.x_cm, endV.y_cm);

    const isSelected = wallId === selectedWallId;
    const isHovered = wallId === hoveredWallId;

    const color = isSelected
      ? COLORS.WALL_SELECTED
      : isHovered
        ? COLORS.WALL_HOVER
        : WALL_TYPE_COLORS[wall.wall_type] || COLORS.INTERIOR_WALL;

    const weight = isSelected ? 3 : isHovered ? 2.5 : 1.5;

    const line = L.polyline([startLatLng, endLatLng] as any, {
      color,
      weight,
      opacity: 0.9,
      interactive: true,
    });

    (line as any).entityId = wallId;
    (line as any).entityType = 'wall';

    centerlinesGroup.addLayer(line as any);

    // 墙体面（简化预览）
    const poly = generateSimpleWallPolygon(startV, endV, wall.thickness_cm);
    if (poly.length === 4) {
      const faceLatLngs = poly.map(
        ([x, y]) => domainXYToLeafletLatLng(x, y),
      );
      const face = L.polygon(faceLatLngs as any, {
        color: color,
        weight: isSelected ? 1.5 : 0.5,
        opacity: 0.4,
        fillColor: color,
        fillOpacity: isSelected ? 0.2 : 0.08,
        interactive: false,
      });
      (face as any).entityId = wallId;
      (face as any).entityType = 'wall_face';
      wallFacesGroup.addLayer(face as any);
    }
  }
}

/**
 * 渲染所有顶点
 */
export function renderVertices(
  doc: PlanDocument,
  verticesGroup: L.LayerGroup,
): void {
  verticesGroup.clearLayers();

  for (const [vertexId, vertex] of Object.entries(doc.vertices)) {
    const latlng = domainXYToLeafletLatLng(vertex.x_cm, vertex.y_cm);

    const marker = L.circleMarker(latlng, {
      radius: 4,
      color: COLORS.VERTEX,
      fillColor: COLORS.VERTEX,
      fillOpacity: 0.8,
      weight: 1,
      interactive: true,
    });

    (marker as any).entityId = vertexId;
    (marker as any).entityType = 'vertex';

    verticesGroup.addLayer(marker as any);
  }
}

/**
 * 渲染所有门窗
 */
export function renderOpenings(
  doc: PlanDocument,
  openingsGroup: L.LayerGroup,
): void {
  openingsGroup.clearLayers();

  for (const [opId, opening] of Object.entries(doc.openings)) {
    const wall = doc.walls[opening.host_wall_id];
    if (!wall) continue;

    const startV = doc.vertices[wall.start_vertex_id];
    const endV = doc.vertices[wall.end_vertex_id];
    if (!startV || !endV) continue;

    const pos = calculateOpeningPosition(
      startV,
      endV,
      opening.offset_from_start_cm,
      opening.width_cm,
    );

    const color = opening.opening_type === 'door' ? COLORS.DOOR : COLORS.WINDOW;
    const latlngs: L.LatLng[] = [
      domainXYToLeafletLatLng(pos.startPoint[0], pos.startPoint[1]),
      domainXYToLeafletLatLng(pos.endPoint[0], pos.endPoint[1]),
    ];

    const line = L.polyline(latlngs, {
      color,
      weight: opening.opening_type === 'door' ? 3 : 2,
      opacity: 0.9,
      interactive: true,
    });

    (line as any).entityId = opId;
    (line as any).entityType = 'opening';

    openingsGroup.addLayer(line as any);
  }
}

/**
 * 渲染所有空间/房间
 */
export function renderSpaces(
  doc: PlanDocument,
  spacesGroup: L.LayerGroup,
): void {
  spacesGroup.clearLayers();

  for (const [spaceId, space] of Object.entries(doc.spaces)) {
    if (!space.generated_polygon || space.generated_polygon.length === 0) continue;

    const ring = space.generated_polygon[0];
    if (ring.length < 3) continue;

    const latlngs: L.LatLng[] = ring.map(
      ([x, y]) => domainXYToLeafletLatLng(x, y),
    );

    const polygon = L.polygon(latlngs, {
      color: COLORS.ROOM_BORDER,
      weight: 0.5,
      fillColor: '#fff',
      fillOpacity: 0.02,
      interactive: true,
    });

    (polygon as any).entityId = spaceId;
    (polygon as any).entityType = 'space';

    spacesGroup.addLayer(polygon as any);

    // 房间标签（中心点 + 编号）
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    cx /= ring.length;
    cy /= ring.length;

    const labelLatLng = domainXYToLeafletLatLng(cx, cy);
    const label = L.marker(labelLatLng, {
      icon: L.divIcon({
        className: 'room-label',
        html: `<div style="
          font-size:11px;
          font-weight:500;
          color:${COLORS.ROOM_LABEL};
          background:rgba(255,255,255,0.85);
          padding:2px 6px;
          border-radius:3px;
          border:1px solid rgba(0,0,0,0.1);
          white-space:nowrap;
        ">${spaceId.toUpperCase()}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      interactive: false,
    });
    spacesGroup.addLayer(label as any);
  }
}

/**
 * 全量渲染（所有图层）
 */
export function renderAll(
  doc: PlanDocument,
  layers: WallLayers,
  selectedWallId: string | null,
  hoveredWallId: string | null,
): void {
  renderWalls(doc, layers.centerlines, layers.wallFaces, selectedWallId, hoveredWallId);
  renderVertices(doc, layers.vertices);
  renderOpenings(doc, layers.openings);
  renderSpaces(doc, layers.spaces);
}
