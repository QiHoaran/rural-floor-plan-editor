// ============================================================
// 通用几何函数单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  distance,
  directionVector,
  projectPointToSegment,
  segmentIntersection,
  polygonArea,
  polygonCentroid,
  pointInPolygon,
  orthoConstraint,
  fortyFiveConstraint,
} from '@/editor/domain/geometry.ts';

describe('距离计算', () => {
  it('两点间距离', () => {
    expect(distance(0, 0, 3, 4)).toBeCloseTo(5);
  });

  it('零距离', () => {
    expect(distance(0, 0, 0, 0)).toBe(0);
  });
});

describe('方向向量', () => {
  it('水平方向', () => {
    const [dx, dy] = directionVector(0, 0, 100, 0);
    expect(dx).toBeCloseTo(1);
    expect(dy).toBeCloseTo(0);
  });

  it('垂直方向', () => {
    const [dx, dy] = directionVector(0, 0, 0, 100);
    expect(dx).toBeCloseTo(0);
    expect(dy).toBeCloseTo(1);
  });
});

describe('点到线段投影', () => {
  const ax = 0, ay = 0, bx = 100, by = 0;

  it('点在线段中间上方', () => {
    const proj = projectPointToSegment(50, 50, ax, ay, bx, by);
    expect(proj.x).toBeCloseTo(50);
    expect(proj.y).toBeCloseTo(0);
    expect(proj.t).toBeCloseTo(0.5);
    expect(proj.dist).toBeCloseTo(50);
  });

  it('点在线段延长线左侧', () => {
    const proj = projectPointToSegment(-50, 0, ax, ay, bx, by);
    expect(proj.x).toBeCloseTo(0); // 被限制到起点
    expect(proj.t).toBeCloseTo(0);
  });

  it('点在线段延长线右侧', () => {
    const proj = projectPointToSegment(150, 0, ax, ay, bx, by);
    expect(proj.x).toBeCloseTo(100); // 被限制到终点
    expect(proj.t).toBeCloseTo(1);
  });

  it('点上在线段起点', () => {
    const proj = projectPointToSegment(0, 0, ax, ay, bx, by);
    expect(proj.x).toBeCloseTo(0);
    expect(proj.y).toBeCloseTo(0);
    expect(proj.dist).toBeCloseTo(0);
  });
});

describe('线段相交', () => {
  it('两条线段十字相交', () => {
    const result = segmentIntersection(0, 50, 100, 50, 50, 0, 50, 100);
    expect(result.intersects).toBe(true);
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(50);
  });

  it('平行线段不相交', () => {
    const result = segmentIntersection(0, 0, 100, 0, 0, 50, 100, 50);
    expect(result.intersects).toBe(false);
  });

  it('端点相接的垂直线段', () => {
    // 两条线段在端点垂直相交
    const result = segmentIntersection(0, 0, 50, 0, 50, 0, 50, 50);
    expect(result.intersects).toBe(true);
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(0);
  });

  it('线段不相交', () => {
    const result = segmentIntersection(0, 0, 30, 0, 50, 50, 80, 80);
    expect(result.intersects).toBe(false);
  });
});

describe('多边形面积', () => {
  it('3x4矩形面积12', () => {
    const verts: [number, number][] = [
      [0, 0],
      [300, 0],
      [300, 400],
      [0, 400],
    ];
    expect(polygonArea(verts)).toBeCloseTo(120000);
  });

  it('三角形面积', () => {
    const verts: [number, number][] = [
      [0, 0],
      [100, 0],
      [0, 100],
    ];
    expect(polygonArea(verts)).toBeCloseTo(5000);
  });
});

describe('多边形质心', () => {
  it('正方形质心', () => {
    const verts: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const [cx, cy] = polygonCentroid(verts);
    expect(cx).toBeCloseTo(50);
    expect(cy).toBeCloseTo(50);
  });
});

describe('点在多边形内部', () => {
  const square: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];

  it('点在内部', () => {
    expect(pointInPolygon(50, 50, square)).toBe(true);
  });

  it('点在外部', () => {
    expect(pointInPolygon(150, 50, square)).toBe(false);
  });

  it('点在边界上', () => {
    expect(pointInPolygon(50, 0, square)).toBe(true);
  });
});

describe('正交约束', () => {
  it('水平方向优先', () => {
    const [x, y] = orthoConstraint(0, 0, 100, 20);
    // dx=100, dy=20, dx≥dy → 水平
    expect(x).toBe(100);
    expect(y).toBe(0);
  });

  it('垂直方向优先', () => {
    const [x, y] = orthoConstraint(0, 0, 20, 100);
    // dx=20, dy=100, dx<dy → 垂直
    expect(x).toBe(0);
    expect(y).toBe(100);
  });
});

describe('45度约束', () => {
  it('接近水平方向', () => {
    const [x, y] = fortyFiveConstraint(0, 0, 100, 10);
    expect(y).toBe(0); // 接近水平
    expect(x).toBe(100);
  });

  it('接近45度方向', () => {
    const [x, y] = fortyFiveConstraint(0, 0, 100, 85);
    // dx和dy接近，所以约束到45度
    expect(Math.abs(x)).toBeGreaterThan(0);
    expect(Math.abs(y)).toBeGreaterThan(0);
    expect(Math.abs(Math.abs(x) - Math.abs(y))).toBeLessThan(15);
  });
});
