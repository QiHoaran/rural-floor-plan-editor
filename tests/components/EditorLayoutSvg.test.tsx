import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorLayout } from '../../src/editor/EditorLayout.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';

describe('EditorLayout SVG integration', () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .loadBuilding(
        createEmptyBuilding('house_0001', 'reference/original.png'),
      );
  });

  it('mounts the SVG CAD canvas for the active building', () => {
    render(<EditorLayout />);

    expect(screen.getByTestId('svg-canvas')).toBeTruthy();
    expect(screen.getByText('house_0001')).toBeTruthy();
  });

  it('shows editable properties for a selected wall', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices = {
      v_1: { x_mm: 0, y_mm: 0 },
      v_2: { x_mm: 3000, y_mm: 0 },
    };
    document.walls = {
      w_1: {
        start_vertex_id: 'v_1',
        end_vertex_id: 'v_2',
        wall_type: 'exterior',
        thickness_mm: 370,
        height_mm: 3000,
        material_type: 'brick',
      },
    };
    document.floors[0].wall_ids = ['w_1'];
    useEditorStore.getState().loadBuilding(document);
    useEditorStore
      .getState()
      .setSelection({ type: 'wall', id: 'w_1' });

    render(<EditorLayout />);

    expect(screen.getByLabelText('墙长（米）')).toBeTruthy();
  });
});
