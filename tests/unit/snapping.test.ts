// ============================================================
// 吸附模块单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { snapToGrid, snapCoordinate } from '@/editor/domain/snapping.ts';

describe('网格吸附', () => {
  it('主网格24cm吸附', () => {
    expect(snapToGrid(100, 24)).toBe(96);  // 100/24≈4.167→4*24=96
    expect(snapToGrid(110, 24)).toBe(120); // 110/24≈4.583→5*24=120
    expect(snapToGrid(0, 24)).toBe(0);
    expect(snapToGrid(24, 24)).toBe(24);
    expect(snapToGrid(47, 24)).toBe(48);
  });

  it('次网格6cm吸附', () => {
    expect(snapToGrid(100, 6)).toBe(102); // 100/6≈16.667→17*6=102
    expect(snapToGrid(103, 6)).toBe(102); // 103/6≈17.167→17*6=102
    expect(snapToGrid(105, 6)).toBe(108); // 105/6≈17.5→18*6=108
  });

  it('精细1cm吸附', () => {
    expect(snapToGrid(100.7, 1)).toBe(101);
    expect(snapToGrid(100.4, 1)).toBe(100);
  });

  it('吸附模式选择正确步长', () => {
    // major = 24cm
    expect(snapCoordinate(100, 'major')).toBe(96);
    // minor = 6cm
    expect(snapCoordinate(100, 'minor')).toBe(102);
    // fine = 1cm
    expect(snapCoordinate(100.7, 'fine')).toBe(101);
    // none = 原值
    expect(snapCoordinate(100.7, 'none')).toBe(100.7);
  });

  it('10m墙在24cm网格上不是整数格', () => {
    // 10m = 1000cm
    // 1000 / 24 = 41.666... 格
    const snappedToMajor = snapToGrid(1000, 24);
    expect(snappedToMajor).not.toBe(1000); // 1000 is between 984 (41*24) and 1008 (42*24)
  });

  it('精确输入不损失精度', () => {
    // 用户输入1000cm, 精细吸附应保留
    expect(snapCoordinate(1000, 'fine')).toBe(1000);
    expect(snapCoordinate(1000, 'none')).toBe(1000);
  });
});
