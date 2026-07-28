import { describe, expect, it } from 'vitest';
import {
  intersectSegments,
  type MillimeterPoint,
} from '../../src/editor/topology/segmentIntersection.ts';

const point = (x_mm: number, y_mm: number): MillimeterPoint => ({ x_mm, y_mm });

describe('intersectSegments', () => {
  it('returns rounded integer millimeter coordinates and parameters for a crossing', () => {
    const result = intersectSegments(
      point(0, 0),
      point(1001, 1000),
      point(0, 1000),
      point(1000, 0),
    );

    expect(result).toEqual({
      kind: 'point',
      point: point(500, 500),
      tA: expect.closeTo(0.49975, 5),
      tB: expect.closeTo(0.50025, 5),
    });
  });

  it('normalizes a contact within one millimeter to the existing endpoint', () => {
    const result = intersectSegments(
      point(0, 0),
      point(1000, 0),
      point(1001, 0),
      point(1001, 500),
    );

    expect(result).toEqual({
      kind: 'point',
      point: point(1000, 0),
      tA: 1,
      tB: 0,
    });
  });

  it('reports a positive-length collinear overlap', () => {
    expect(
      intersectSegments(
        point(0, 0),
        point(1000, 0),
        point(250, 0),
        point(1250, 0),
      ),
    ).toEqual({
      kind: 'overlap',
      from: point(250, 0),
      to: point(1000, 0),
    });
  });

  it('returns overlap endpoints in the same coordinate order when segments are reversed or exchanged', () => {
    const expected = {
      kind: 'overlap',
      from: point(250, 0),
      to: point(1000, 0),
    } as const;

    expect(
      intersectSegments(
        point(0, 0),
        point(1000, 0),
        point(250, 0),
        point(1250, 0),
      ),
    ).toEqual(expected);
    expect(
      intersectSegments(
        point(1250, 0),
        point(250, 0),
        point(1000, 0),
        point(0, 0),
      ),
    ).toEqual(expected);
  });

  it('reports an exactly one millimeter positive-length overlap', () => {
    expect(
      intersectSegments(
        point(0, 0),
        point(10, 0),
        point(9, 0),
        point(20, 0),
      ),
    ).toEqual({
      kind: 'overlap',
      from: point(9, 0),
      to: point(10, 0),
    });
  });

  it('allows collinear segments that only touch end-to-end', () => {
    expect(
      intersectSegments(
        point(0, 0),
        point(1000, 0),
        point(1000, 0),
        point(2000, 0),
      ),
    ).toEqual({
      kind: 'point',
      point: point(1000, 0),
      tA: 1,
      tB: 0,
    });
  });

  it('returns none for separated segments', () => {
    expect(
      intersectSegments(
        point(0, 0),
        point(1000, 0),
        point(0, 100),
        point(1000, 100),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('chooses the same canonical near-endpoint intersection when A and B are exchanged', () => {
    const aStart = point(-1000, 0);
    const aEnd = point(-1, 0);
    const bStart = point(0, 1);
    const bEnd = point(0, 1000);

    const ab = intersectSegments(aStart, aEnd, bStart, bEnd);
    const ba = intersectSegments(bStart, bEnd, aStart, aEnd);

    expect(ab.kind).toBe('point');
    expect(ba.kind).toBe('point');
    if (ab.kind !== 'point' || ba.kind !== 'point') return;
    expect(ab.point).toEqual(ba.point);
    expect(ab.point).toEqual(point(-1, 0));
  });
});
