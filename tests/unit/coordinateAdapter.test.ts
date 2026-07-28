// ============================================================
// 坐标转换模块单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  domainXYToLatLng,
  latLngToDomainXY,
  leafletLatLngToDomainXY,
  imagePixelToDomainXY,
  domainXYToImagePixel,
  roundToPrecision,
  distanceBetweenPoints_cm,
  angleBetweenPoints_deg,
} from '@/editor/leaflet/coordinateAdapter.ts';

// Leaflet的LatLng在测试环境可能不可用，用模拟替代
class MockLatLng {
  lat: number;
  lng: number;
  constructor(lat: number, lng: number) {
    this.lat = lat;
    this.lng = lng;
  }
}

describe('坐标转换 - 领域坐标 <=> Leaflet坐标', () => {
  it('domainXYToLatLng 将领域 [x, y] 转为 Leaflet [lat, lng]', () => {
    const result = domainXYToLatLng(100, 200);
    expect(result).toEqual([200, 100]); // [lat=y, lng=x]
  });

  it('latLngToDomainXY 将 Leaflet [lat, lng] 转为领域 [x, y]', () => {
    const result = latLngToDomainXY(200, 100);
    expect(result).toEqual([100, 200]); // [x=lng, y=lat]
  });

  it('双向转换一致性', () => {
    const originalX = 456;
    const originalY = 789;
    const latlng = domainXYToLatLng(originalX, originalY);
    const [backX, backY] = latLngToDomainXY(latlng[0], latlng[1]);
    expect(backX).toBe(originalX);
    expect(backY).toBe(originalY);
  });
});

describe('坐标转换 - 图片像素坐标', () => {
  const imgW = 1600;
  const imgH = 900;
  const metersPerPixel = 0.01; // 1 pixel = 1 cm

  it('图片左下角对应领域坐标原点', () => {
    const [x, y] = imagePixelToDomainXY(0, imgH, imgW, imgH, metersPerPixel);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  it('图片像素转领域坐标 (中心点)', () => {
    // 图片中心: px=800, py=450
    const [x, y] = imagePixelToDomainXY(800, 450, imgW, imgH, metersPerPixel);
    expect(x).toBe(800); // 800 * 1cm
    expect(y).toBe(450); // (900-450) * 1cm
  });

  it('领域坐标转回图片像素', () => {
    const [px, py] = domainXYToImagePixel(800, 450, imgW, imgH, metersPerPixel);
    expect(px).toBe(800);
    expect(py).toBe(450);
  });

  it('像素-领域-像素 循环一致性', () => {
    const origPx = 1234;
    const origPy = 567;
    const [x, y] = imagePixelToDomainXY(origPx, origPy, imgW, imgH, metersPerPixel);
    const [backPx, backPy] = domainXYToImagePixel(x, y, imgW, imgH, metersPerPixel);
    expect(backPx).toBe(origPx);
    expect(backPy).toBe(origPy);
  });

  it('未标定时像素直接作为厘米坐标', () => {
    const [x, y] = imagePixelToDomainXY(500, 300, imgW, imgH, null);
    expect(x).toBe(500);
    expect(y).toBe(600); // 900-300
  });
});

describe('四舍五入到指定精度', () => {
  it('1cm精度', () => {
    expect(roundToPrecision(100.7)).toBe(101);
    expect(roundToPrecision(100.4)).toBe(100);
  });

  it('24cm网格精度', () => {
    expect(roundToPrecision(100, 24)).toBe(96); // 100 / 24 = 4.167 -> 4 * 24 = 96
    expect(roundToPrecision(110, 24)).toBe(120); // 110 / 24 = 4.583 -> 5 * 24 = 120
  });

  it('6cm网格精度', () => {
    expect(roundToPrecision(100, 6)).toBe(102); // 100 / 6 = 16.667 -> 17 * 6 = 102
  });
});

describe('距离和角度计算', () => {
  it('水平距离', () => {
    const dist = distanceBetweenPoints_cm(0, 0, 1000, 0);
    expect(dist).toBe(1000);
  });

  it('垂直距离', () => {
    const dist = distanceBetweenPoints_cm(0, 0, 0, 500);
    expect(dist).toBe(500);
  });

  it('对角距离四舍五入', () => {
    const dist = distanceBetweenPoints_cm(0, 0, 300, 400);
    expect(dist).toBe(500); // 3-4-5 三角形
  });

  it('水平线角度为0°', () => {
    const angle = angleBetweenPoints_deg(0, 0, 100, 0);
    expect(angle).toBe(0);
  });

  it('垂直线角度为90°', () => {
    const angle = angleBetweenPoints_deg(0, 0, 0, 100);
    expect(angle).toBe(90);
  });

  it('反向水平线角度为180°', () => {
    const angle = angleBetweenPoints_deg(100, 0, 0, 0);
    expect(angle).toBe(180);
  });
});
