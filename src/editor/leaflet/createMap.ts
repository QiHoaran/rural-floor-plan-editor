// ============================================================
// Leaflet CRS.Simple 地图初始化
// ============================================================

import L from 'leaflet';
import { MAP_MIN_ZOOM, MAP_MAX_ZOOM, MAP_ZOOM } from '@/editor/domain/constants.ts';

/**
 * 创建并配置 CRS.Simple 局部平面地图
 * - CRS.Simple 使 Leaflet 适用于平面坐标（非地理坐标）
 * - [lat, lng] = [y, x]，领域坐标统一使用 [x_cm, y_cm]
 * - 坐标通过 coordinateAdapter 转换
 */
export function createMap(container: HTMLElement): L.Map {
  const map = new L.Map(container, {
    crs: L.CRS.Simple,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    zoom: MAP_ZOOM,
    center: [0, 0],
    attributionControl: false,
    zoomControl: true,
  });

  // 设置地图背景色
  (map as any)._container.style.background = '#f8fafc';

  // 添加导航控件
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  return map;
}

/**
 * 设置地图的可见范围以适配图片
 */
export function fitMapToImageBounds(
  map: L.Map,
  imageWidthPx: number,
  imageHeightPx: number,
  metersPerPixel: number | null,
): void {
  if (!metersPerPixel) {
    // 未标定时使用像素坐标
    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [imageHeightPx, imageWidthPx],
    ];
    map.fitBounds(bounds, { padding: [50, 50] });
    return;
  }

  // 标定后使用实际厘米坐标
  const cmPerPixel = metersPerPixel * 100;
  const widthCm = imageWidthPx * cmPerPixel;
  const heightCm = imageHeightPx * cmPerPixel;

  const bounds: L.LatLngBoundsExpression = [
    [0, 0],
    [heightCm, widthCm],
  ];
  map.fitBounds(bounds, { padding: [50, 50] });
}

/**
 * 获取地图最大可见范围（带缓冲）
 */
export function getExtendedBounds(
  _map: L.Map,
  imageWidthPx: number,
  imageHeightPx: number,
  metersPerPixel: number | null,
): L.LatLngBounds {
  const cmPerPixel = metersPerPixel ? metersPerPixel * 100 : 1;
  const w = imageWidthPx * cmPerPixel * 1.5;
  const h = imageHeightPx * cmPerPixel * 1.5;
  return new L.LatLngBounds(new L.LatLng(-h * 0.25, -w * 0.25), new L.LatLng(h * 1.25, w * 1.25));
}
