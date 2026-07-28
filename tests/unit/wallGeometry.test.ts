// ============================================================
// 墙体几何计算单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import type { Vertex, Wall } from '@/editor/domain/planTypes.ts';
import { wallLengthCm, wallAngleDeg, calculateNewEndpoints, generateSimpleWallPolygon, areWallsOverlapping } from '@/editor/domain/wallGeometry.ts';

const startV: Vertex = { x_cm: 0, y_cm: 0 };
const endV: Vertex = { x_cm: 1000, y_cm: 0 };
const wall: Wall = {
  start_vertex_id: 'v001',
  end_vertex_id: 'v002',
  wall_type: 'exterior',
  thickness_cm: 37,
  height_cm: 300,
  material_type: 'brick',
  review_status: 'draft',
};

describe('墙长计算', () => {
  it('水平墙长', () => {
    expect(wallLengthCm(startV, endV)).toBe(1000);
  });

  it('垂直墙长', () => {
    expect(wallLengthCm(startV, { x_cm: 0, y_cm: 500 })).toBe(500);
  });

  it('对角墙长四舍五入', () => {
    expect(wallLengthCm(startV, { x_cm: 300, y_cm: 400 })).toBe(500);
  });

  it('零长度墙', () => {
    expect(wallLengthCm(startV, startV)).toBe(0);
  });
});

describe('墙角度计算', () => {
  it('水平墙角度为0°', () => {
    expect(wallAngleDeg(startV, endV)).toBe(0);
  });

  it('垂直墙角度为90°', () => {
    expect(wallAngleDeg(startV, { x_cm: 0, y_cm: 500 })).toBe(90);
  });

  it('45度墙', () => {
    expect(wallAngleDeg(startV, { x_cm: 100, y_cm: 100 })).toBe(45);
  });

  it('角度范围在[0,360)', () => {
    const angle = wallAngleDeg({ x_cm: 100, y_cm: 0 }, startV);
    expect(angle).toBe(180);
  });
});

describe('修改墙长', () => {
  it('固定起点修改墙长', () => {
    const result = calculateNewEndpoints(wall, startV, endV, 500, 'start');
    expect(result.newStartX).toBe(0);
    expect(result.newStartY).toBe(0);
    expect(result.newEndX).toBe(500);
    expect(result.newEndY).toBe(0);
  });

  it('固定终点修改墙长', () => {
    const result = calculateNewEndpoints(wall, startV, endV, 500, 'end');
    expect(result.newEndX).toBe(1000);
    expect(result.newEndY).toBe(0);
    expect(result.newStartX).toBe(500);
    expect(result.newStartY).toBe(0);
  });

  it('固定中点修改墙长', () => {
    const result = calculateNewEndpoints(wall, startV, endV, 800, 'midpoint');
    expect(result.newStartX).toBe(100);
    expect(result.newStartY).toBe(0);
    expect(result.newEndX).toBe(900);
    expect(result.newEndY).toBe(0);
  });

  it('10米墙精确修改为10.00米', () => {
    // 用户从42格(1008cm)改回1000cm
    const longStart: Vertex = { x_cm: 0, y_cm: 0 };
    const longEnd: Vertex = { x_cm: 1008, y_cm: 0 };
    const result = calculateNewEndpoints(wall, longStart, longEnd, 1000, 'start');
    expect(result.newEndX).toBe(1000);
    expect(result.newEndY).toBe(0);
  });
});

describe('墙体面生成', () => {
  it('37cm墙生成四个顶点', () => {
    const poly = generateSimpleWallPolygon(startV, endV, 37);
    expect(poly.length).toBe(4);
  });

  it('墙体面宽度等于墙厚', () => {
    const poly = generateSimpleWallPolygon(startV, endV, 24);
    // 上边两个点的y差应该约等于24cm
    expect(Math.abs(poly[0][1] - poly[3][1])).toBeCloseTo(24, 0);
  });

  it('零长度墙返回空数组', () => {
    const poly = generateSimpleWallPolygon(startV, startV, 24);
    expect(poly.length).toBe(0);
  });

  it('墙体面允许0.5cm小数', () => {
    const poly = generateSimpleWallPolygon(startV, endV, 37);
    // 37/2 = 18.5, 所以y坐标应该是 ±18.5
    for (const v of poly) {
      expect(v[1] * 2).toBe(Math.round(v[1] * 2)); // 0.5 cm精度
    }
  });
});

describe('重复墙检测', () => {
  it('平行重叠墙被检测', () => {
    const w1a: Vertex = { x_cm: 0, y_cm: 0 };
    const w1b: Vertex = { x_cm: 1000, y_cm: 0 };
    const w2a: Vertex = { x_cm: 0, y_cm: 20 };
    const w2b: Vertex = { x_cm: 1000, y_cm: 20 };
    expect(areWallsOverlapping(w1a, w1b, w2a, w2b, 24)).toBe(true);
  });

  it('垂直与水平墙不重叠', () => {
    const w1a: Vertex = { x_cm: 0, y_cm: 0 };
    const w1b: Vertex = { x_cm: 1000, y_cm: 0 };
    const w2a: Vertex = { x_cm: 500, y_cm: 0 };
    const w2b: Vertex = { x_cm: 500, y_cm: 500 };
    expect(areWallsOverlapping(w1a, w1b, w2a, w2b, 24)).toBe(false);
  });
});
