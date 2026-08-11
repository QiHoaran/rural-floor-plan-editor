import { describe, expect, it } from 'vitest';
import { resolveWallElementPlacement } from '../../src/editor/domain/wallElementPlacement.ts';

describe('wall element placement', () => {
  it.each([
    [760, '1/4', 100],
    [1490, '1/2', 850],
    [2260, '3/4', 1600],
  ] as const)('snaps center %d to wall fraction %s', (requested, fraction, offset) => {
    expect(resolveWallElementPlacement(3000, 1300, requested, 20)).toEqual({
      centerOffsetMm: offset + 650,
      offsetFromStartMm: offset,
      fraction,
    });
  });

  it('allows zero clearance and clamps beyond either wall end', () => {
    expect(resolveWallElementPlacement(2000, 1800, 0, 0)).toMatchObject({
      centerOffsetMm: 900,
      offsetFromStartMm: 0,
    });
    expect(resolveWallElementPlacement(2000, 1800, 2500, 0)).toMatchObject({
      centerOffsetMm: 1100,
      offsetFromStartMm: 200,
    });
  });
});
