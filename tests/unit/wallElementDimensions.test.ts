import { describe, expect, it } from 'vitest';
import {
  formatWallElementDimensions,
  parseWallElementDimensions,
} from '../../src/editor/domain/wallElementDimensions.ts';

describe('wall element dimension input', () => {
  it.each(['1.0×2.1', '1*2.1', '1x2.1', '1,0 X 2,1'])(
    'parses %s as width and height in millimeters',
    (value) => {
      expect(parseWallElementDimensions(value)).toEqual({
        ok: true,
        widthMm: 1000,
        heightMm: 2100,
        normalized: '1×2.1',
      });
    },
  );

  it('rejects missing separators and non-positive dimensions', () => {
    expect(parseWallElementDimensions('1.0')).toMatchObject({ ok: false });
    expect(parseWallElementDimensions('0×2.1')).toMatchObject({ ok: false });
  });

  it('formats stored millimeters without redundant zeroes', () => {
    expect(formatWallElementDimensions(1200, 1500)).toBe('1.2×1.5');
  });
});
