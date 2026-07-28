import { describe, expect, it } from 'vitest';
import { parseCoordinateMeters } from '../../src/editor/domain/cadInput.ts';

describe('parseCoordinateMeters', () => {
  it('accepts signed decimal meters and rounds to integer millimeters', () => {
    expect(parseCoordinateMeters('-1.2345')).toEqual({
      ok: true,
      millimeters: -1234,
      normalized: '-1.234',
    });
    expect(parseCoordinateMeters('0')).toMatchObject({ ok: true, millimeters: 0 });
  });

  it('rejects non-finite and unsafe coordinate input in Chinese', () => {
    for (const value of ['', 'Infinity', '1e999', '9007199254740992']) {
      const result = parseCoordinateMeters(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/坐标|数字|安全/);
    }
  });
});
