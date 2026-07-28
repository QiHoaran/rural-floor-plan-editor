import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditablePropertyPanel } from '../../src/editor/panels/EditablePropertyPanel.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';

function loadWall() {
  const document = createEmptyBuilding(
    'house_0001',
    'reference/original.png',
  );
  document.vertices = {
    v_1: { x_mm: 1000, y_mm: 1000 },
    v_2: { x_mm: 5500, y_mm: 1000 },
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
}

describe('EditablePropertyPanel', () => {
  beforeEach(loadWall);

  it('edits wall length in meters while fixing the selected anchor', () => {
    render(<EditablePropertyPanel />);
    const length = screen.getByLabelText('墙长（米）');

    expect((length as HTMLInputElement).value).toBe('4.500');
    fireEvent.change(length, { target: { value: '5.2' } });
    fireEvent.blur(length);

    const document = useEditorStore.getState().buildingDocument!;
    expect(document.vertices.v_1).toEqual({ x_mm: 1000, y_mm: 1000 });
    expect(document.vertices.v_2).toEqual({ x_mm: 6200, y_mm: 1000 });
  });

  it('can fix the end vertex when changing length', () => {
    render(<EditablePropertyPanel />);
    fireEvent.change(screen.getByLabelText('固定端'), {
      target: { value: 'end' },
    });
    const length = screen.getByLabelText('墙长（米）');
    fireEvent.change(length, { target: { value: '4' } });
    fireEvent.blur(length);

    const document = useEditorStore.getState().buildingDocument!;
    expect(document.vertices.v_1).toEqual({ x_mm: 1500, y_mm: 1000 });
    expect(document.vertices.v_2).toEqual({ x_mm: 5500, y_mm: 1000 });
  });

  it('rejects non-positive thickness without changing the wall', () => {
    render(<EditablePropertyPanel />);
    const thickness = screen.getByLabelText('墙厚（米）');
    fireEvent.change(thickness, { target: { value: '0' } });
    fireEvent.blur(thickness);

    expect(screen.getByText('墙厚必须大于 0')).toBeTruthy();
    expect(
      useEditorStore.getState().buildingDocument!.walls.w_1.thickness_mm,
    ).toBe(370);
  });

  it('edits reference opacity without changing wall vertices', () => {
    const before = structuredClone(
      useEditorStore.getState().buildingDocument!.vertices,
    );
    useEditorStore.getState().setTool('adjust_reference');
    render(<EditablePropertyPanel />);
    const opacity = screen.getByLabelText('透明度');
    fireEvent.change(opacity, { target: { value: '0.3' } });
    fireEvent.blur(opacity);

    const document = useEditorStore.getState().buildingDocument!;
    expect(document.reference_image.opacity).toBe(0.3);
    expect(document.vertices).toEqual(before);
  });

  it('shows the face function panel for a selected face', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices.v_3 = { x_mm: 5500, y_mm: 4000 };
    document.faces.face_1 = {
      boundary_vertex_ids: ['v_1', 'v_2', 'v_3'],
      area_mm2: 6_750_000,
      function_code: null,
      display_name: '',
      color: '',
      local_name: '',
    };
    document.floors[0].face_ids = ['face_1'];
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setSelection({ type: 'face', id: 'face_1' });

    render(<EditablePropertyPanel />);

    expect(screen.getByText('功能面属性')).toBeTruthy();
    expect(screen.getByLabelText('功能类型')).toBeTruthy();
  });
});
