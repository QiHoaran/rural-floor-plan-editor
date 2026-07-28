// ============================================================
// 门窗几何计算单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import type { Vertex } from '@/editor/domain/planTypes.ts';
import { calculateOpeningPosition, isOpeningWithinWall, checkOpeningsOverlap, findOrphanedOpenings, reassignOpeningAfterSplit } from '@/editor/domain/openingGeometry.ts';
import type { Opening } from '@/editor/domain/planTypes.ts';

const startV: Vertex = { x_cm: 0, y_cm: 0 };
const endV: Vertex = { x_cm: 1000, y_cm: 0 };

describe('门窗位置计算', () => {
  it('门窗在墙的中点（偏移500cm, 宽90cm）', () => {
    const pos = calculateOpeningPosition(startV, endV, 500, 90);
    expect(pos.center[0]).toBeCloseTo(500);
    expect(pos.center[1]).toBeCloseTo(0);
    // 起点: 500 - 45 = 455
    expect(pos.startPoint[0]).toBeCloseTo(455);
    // 终点: 500 + 45 = 545
    expect(pos.endPoint[0]).toBeCloseTo(545);
  });

  it('门窗在墙起点', () => {
    const pos = calculateOpeningPosition(startV, endV, 45, 90);
    expect(pos.startPoint[0]).toBeCloseTo(0);
    expect(pos.center[0]).toBeCloseTo(45);
  });

  it('门窗在墙终点', () => {
    const pos = calculateOpeningPosition(startV, endV, 955, 90);
    expect(pos.endPoint[0]).toBeCloseTo(1000);
    expect(pos.center[0]).toBeCloseTo(955);
  });

  it('垂直墙上门窗位置', () => {
    const vStart: Vertex = { x_cm: 0, y_cm: 0 };
    const vEnd: Vertex = { x_cm: 0, y_cm: 500 };
    const pos = calculateOpeningPosition(vStart, vEnd, 250, 90);
    expect(pos.center[0]).toBeCloseTo(0);
    expect(pos.center[1]).toBeCloseTo(250);
    expect(pos.wallAngle).toBeCloseTo(90);
  });
});

describe('门窗墙内范围检查', () => {
  it('门窗在墙内有效', () => {
    const result = isOpeningWithinWall(startV, endV, 500, 90);
    expect(result.valid).toBe(true);
  });

  it('门窗宽度超过墙长', () => {
    const result = isOpeningWithinWall(startV, { x_cm: 50, y_cm: 0 }, 25, 90);
    expect(result.valid).toBe(false);
  });

  it('门窗左侧超出墙起点', () => {
    const result = isOpeningWithinWall(startV, endV, 10, 90);
    expect(result.valid).toBe(false);
  });

  it('门窗右侧超出墙终点', () => {
    const result = isOpeningWithinWall(startV, endV, 990, 90);
    expect(result.valid).toBe(false);
  });
});

describe('门窗重叠检查', () => {
  it('不重叠的门窗', () => {
    const result = checkOpeningsOverlap([
      { id: 'd001', offset: 200, width: 90 },
      { id: 'd002', offset: 800, width: 90 },
    ]);
    expect(result.overlapped).toBe(false);
    expect(result.pairs.length).toBe(0);
  });

  it('重叠的门窗', () => {
    const result = checkOpeningsOverlap([
      { id: 'd001', offset: 300, width: 200 },
      { id: 'd002', offset: 350, width: 100 },
    ]);
    expect(result.overlapped).toBe(true);
    expect(result.pairs.length).toBe(1);
  });

  it('刚好接触的门窗不算重叠', () => {
    const result = checkOpeningsOverlap([
      { id: 'd001', offset: 50, width: 100 }, // [0, 100]
      { id: 'd002', offset: 150, width: 100 }, // [100, 200]
    ]);
    expect(result.overlapped).toBe(false);
  });
});

describe('孤立门窗检查', () => {
  it('检测到孤立门窗', () => {
    const openings: Record<string, Opening> = {
      d001: {
        opening_type: 'door',
        host_wall_id: 'w001',
        offset_from_start_cm: 200,
        width_cm: 90,
        height_cm: 210,
        sill_height_cm: 0,
        review_status: 'draft',
      },
      d002: {
        opening_type: 'door',
        host_wall_id: 'w002', // w002已删除
        offset_from_start_cm: 400,
        width_cm: 90,
        height_cm: 210,
        sill_height_cm: 0,
        review_status: 'draft',
      },
    };
    const orphaned = findOrphanedOpenings(new Set(['w002']), openings);
    expect(orphaned).toEqual(['d002']);
  });

  it('无孤立门窗', () => {
    const openings: Record<string, Opening> = {
      d001: {
        opening_type: 'door',
        host_wall_id: 'w001',
        offset_from_start_cm: 200,
        width_cm: 90,
        height_cm: 210,
        sill_height_cm: 0,
        review_status: 'draft',
      },
    };
    const orphaned = findOrphanedOpenings(new Set(['w002']), openings);
    expect(orphaned).toEqual([]);
  });
});

describe('墙拆分后门窗归属', () => {
  it('偏移在分割点之前的门窗归前段墙', () => {
    const opening: Opening = {
      opening_type: 'door',
      host_wall_id: 'w001',
      offset_from_start_cm: 200,
      width_cm: 90,
      height_cm: 210,
      sill_height_cm: 0,
      review_status: 'draft',
    };
    const result = reassignOpeningAfterSplit(opening, 1000, 400, 'w001a', 400, 'w001b', 600);
    expect(result).not.toBeNull();
    expect(result!.newHostWallId).toBe('w001a');
    expect(result!.newOffset).toBe(200);
  });

  it('偏移在分割点之后的门窗归后段墙', () => {
    const opening: Opening = {
      opening_type: 'door',
      host_wall_id: 'w001',
      offset_from_start_cm: 600,
      width_cm: 90,
      height_cm: 210,
      sill_height_cm: 0,
      review_status: 'draft',
    };
    const result = reassignOpeningAfterSplit(opening, 1000, 400, 'w001a', 400, 'w001b', 600);
    expect(result).not.toBeNull();
    expect(result!.newHostWallId).toBe('w001b');
    expect(result!.newOffset).toBe(200);
  });
});
