// ============================================================
// 坐标转换模块 — 唯一的坐标转换入口
//
// Leaflet CRS.Simple 使用 [lat, lng] = [y, x]
// 领域数据统一使用 [x_cm, y_cm]
// ============================================================

import L from 'leaflet';

/**
 * Map Units 与厘米的换算比例
 * 1 map unit = 1 cm
 * 即 meters_per_pixel = 0.01 → 每个像素对应0.01 map units
 */
const CM_PER_MAP_UNIT = 1;

/**
 * 领域坐标 [x_cm, y_cm] → Leaflet [lat, lng]
 *
 * CRS.Simple 中:
 *   lat = y (向上)
 *   lng = x (向右)
 */
export function domainXYToLatLng(x_cm: number, y_cm: number): [number, number] {
  return [y_cm, x_cm];
}

/**
 * Leaflet [lat, lng] → 领域坐标 [x_cm, y_cm]
 */
export function latLngToDomainXY(lat: number, lng: number): [number, number] {
  return [lng, lat];
}

/**
 * Leaflet LatLng → 领域坐标 [x_cm, y_cm]
 */
export function leafletLatLngToDomainXY(latlng: L.LatLng): [number, number] {
  return [latlng.lng, latlng.lat];
}

/**
 * 领域坐标 [x_cm, y_cm] → Leaflet LatLng
 */
export function domainXYToLeafletLatLng(x_cm: number, y_cm: number): L.LatLng {
  return new L.LatLng(y_cm, x_cm);
}

/**
 * 图片像素坐标 → 领域坐标 [x_cm, y_cm]
 *
 * 假设图片左下角在领域坐标的原点(0,0)
 * pixels_per_cm = 1 / (meters_per_pixel * 100)
 */
export function imagePixelToDomainXY(
  px: number,
  py: number,
  _imageWidthPx: number,
  imageHeightPx: number,
  metersPerPixel: number | null,
): [number, number] {
  if (metersPerPixel === null) {
    // 未标定时，返回像素偏移值（像素直接当做厘米）
    return [px, imageHeightPx - py];
  }
  const cmPerPixel = metersPerPixel * 100;
  const x_cm = px * cmPerPixel;
  const y_cm = (imageHeightPx - py) * cmPerPixel;
  return [Math.round(x_cm), Math.round(y_cm)];
}

/**
 * 领域坐标 [x_cm, y_cm] → 图片像素坐标
 */
export function domainXYToImagePixel(
  x_cm: number,
  y_cm: number,
  _imageWidthPx: number,
  imageHeightPx: number,
  metersPerPixel: number | null,
): [number, number] {
  if (metersPerPixel === null) {
    // 未标定时，直接返回坐标值
    return [x_cm, imageHeightPx - y_cm];
  }
  const cmPerPixel = metersPerPixel * 100;
  const px = x_cm / cmPerPixel;
  const py = imageHeightPx - y_cm / cmPerPixel;
  return [Math.round(px), Math.round(py)];
}

/**
 * 厘米 → Leaflet Map Units
 */
export function cmToMapUnits(cm: number): number {
  return cm / CM_PER_MAP_UNIT;
}

/**
 * Leaflet Map Units → 厘米
 */
export function mapUnitsToCm(mapUnits: number): number {
  return mapUnits * CM_PER_MAP_UNIT;
}

/**
 * 四舍五入坐标到给定精度（默认1 cm）
 */
export function roundToPrecision(value: number, precisionCm: number = 1): number {
  return Math.round(value / precisionCm) * precisionCm;
}

/**
 * 四舍五入领域坐标对到给定精度
 */
export function roundCoordinatePair(
  x_cm: number,
  y_cm: number,
  precisionCm: number = 1,
): [number, number] {
  return [roundToPrecision(x_cm, precisionCm), roundToPrecision(y_cm, precisionCm)];
}

/**
 * 创建 CRS.Simple 地图，配置坐标范围
 */
export function createSimpleMap(container: HTMLElement, _bounds?: unknown): L.Map {
  const map = new L.Map(container, {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 8,
    zoom: 0,
    center: [0, 0],
    attributionControl: false,
  });
  return map;
}

/**
 * 计算两点之间的距离（cm）
 */
export function distanceBetweenPoints_cm(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  return Math.round(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2));
}

/**
 * 计算两点之间的角度（度）
 * 0° = 水平向右，逆时针为正
 */
export function angleBetweenPoints_deg(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  // 标准化到 [0, 360)
  return ((angle % 360) + 360) % 360;
}
