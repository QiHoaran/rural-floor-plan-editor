import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverlayLayer } from '../../src/editor/canvas/layers/OverlayLayer.tsx';
import type { SnapResult } from '../../src/editor/cad/snapEngine.ts';

const command = {
  phase: 'drawing' as const,
  start: { point: { x_mm: 0, y_mm: 0 } },
  cursor: { x_mm: 100, y_mm: 100 },
  previewEnd: { x_mm: 100, y_mm: 100 },
  direction: { dx: 1, dy: 0, angle_deg: 0 },
  angleDeg: 0,
  input: '',
};

describe('OverlayLayer snap markers', () => {
  it.each([
    [
      'vertex',
      { kind: 'vertex', point: { x_mm: 10, y_mm: 10 }, vertexId: 'v_1' },
    ],
    [
      'intersection',
      {
        kind: 'intersection',
        point: { x_mm: 20, y_mm: 20 },
        wallIds: ['w_1', 'w_2'],
      },
    ],
    [
      'wall_projection',
      {
        kind: 'wall_projection',
        point: { x_mm: 30, y_mm: 30 },
        wallId: 'w_1',
      },
    ],
    ['grid', { kind: 'grid', point: { x_mm: 40, y_mm: 40 } }],
  ] satisfies Array<[string, SnapResult]>)(
    'renders an accessible %s marker',
    (kind, snap) => {
      render(
        <svg>
          <OverlayLayer
            command={command}
            pixelsPerMm={0.1}
            snap={snap}
          />
        </svg>,
      );

      const labels = {
        vertex: '顶点吸附',
        intersection: '交点吸附',
        wall_projection: '墙上投影吸附',
        grid: '网格吸附',
      };
      const marker = screen.getByLabelText(
        labels[kind as keyof typeof labels],
      );
      expect(marker.getAttribute('role')).toBe('img');
    },
  );
});
