import { describe, expect, it } from 'vitest';
import { parseMeters } from '../../src/editor/domain/cadInput.ts';

describe('parseMeters', () => {
  it('converts meter input to whole millimeters', () => {
    expect(parseMeters('4.5')).toEqual({
      ok: true,
      millimeters: 4500,
      normalized: '4.500',
    });
    expect(parseMeters('0.01')).toEqual({
      ok: true,
      millimeters: 10,
      normalized: '0.010',
    });
    expect(parseMeters('4,5')).toEqual({
      ok: true,
      millimeters: 4500,
      normalized: '4.500',
    });
  });

  it.each(['', '0', '-3', 'abc', '1.2.3'])(
    'rejects invalid length %j',
    (value) => {
      expect(parseMeters(value)).toMatchObject({ ok: false });
    },
  );

  it.each([
    `1${'0'.repeat(306)}`,
    '9007199254741',
  ])('rejects meter input whose millimeter result is not a finite safe integer', (value) => {
    expect(Number(value)).toSatisfy(Number.isFinite);
    expect(parseMeters(value)).toMatchObject({ ok: false });
  });

  it('enforces the command-specific minimum length', () => {
    expect(parseMeters('0.05', 100)).toEqual({
      ok: false,
      message: '墙体长度不能小于 0.10 m',
    });
  });
});
