import {
  act,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SvgCanvas } from '../../src/editor/canvas/SvgCanvas.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';

describe('SvgCanvas', () => {
  beforeEach(() => {
    const document = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    );
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
    useEditorStore.getState().setSnapMode('geometry');
    useEditorStore.getState().setDirectionMode('orthogonal');
    useEditorStore.getState().setViewport({
      originXmm: -1000,
      originYmm: -1000,
      pixelsPerMm: 0.1,
    });
  });

  it('renders wall polygons with accessible hit lines', () => {
    render(<SvgCanvas />);

    expect(screen.getByTestId('wall-polygon-w_1')).toBeTruthy();
    expect(screen.getByTestId('wall-hit-w_1')).toBeTruthy();
    expect(
      screen.getByTestId('reference-image').getAttribute('href'),
    ).toBe(
      '/api/projects/house_0001/files/reference/original.png',
    );
  });

  it('keeps the selected wall outline at a fixed three screen pixels', () => {
    useEditorStore
      .getState()
      .setSelection({ type: 'wall', id: 'w_1' });
    render(<SvgCanvas />);

    const polygon = screen.getByTestId('wall-polygon-w_1');
    expect(polygon.getAttribute('vector-effect')).toBe(
      'non-scaling-stroke',
    );
    expect(polygon.getAttribute('stroke-width')).toBe('3');
  });

  it('draws a precise 4.5 meter wall from typed input', () => {
    useEditorStore.getState().setTool('exterior_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 360 });
    expect(screen.getByTestId('wall-preview')).toBeTruthy();

    fireEvent.keyDown(window, { key: '4' });
    fireEvent.keyDown(window, { key: '.' });
    fireEvent.keyDown(window, { key: '5' });
    expect(screen.getByTestId('command-input').textContent).toContain('4.5');

    fireEvent.keyDown(window, { key: 'Enter' });

    const document = useEditorStore.getState().buildingDocument!;
    expect(Object.keys(document.walls)).toHaveLength(2);
    const addedWall = Object.entries(document.walls).find(
      ([wallId]) => wallId !== 'w_1',
    )![1];
    const start = document.vertices[addedWall.start_vertex_id];
    const end = document.vertices[addedWall.end_vertex_id];
    expect(Math.hypot(end.x_mm - start.x_mm, end.y_mm - start.y_mm)).toBe(
      4500,
    );
  });

  it('activates Alt continuation on move and keeps it active after Alt release', () => {
    useEditorStore.getState().setTool('exterior_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 400 });
    fireEvent.keyDown(window, { key: 'Alt' });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 300 });
    expect(screen.getByText('续画已激活')).toBeTruthy();
    fireEvent.keyUp(window, { key: 'Alt' });
    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: 'Enter' });

    const next = useEditorStore.getState().buildingDocument!;
    const addedWalls = Object.entries(next.walls).filter(
      ([wallId]) => wallId !== 'w_1',
    );
    expect(addedWalls).toHaveLength(2);
    expect(addedWalls[0][1].end_vertex_id).toBe(
      addedWalls[1][1].start_vertex_id,
    );
  });

  it('does nothing when Alt is held without a continuation anchor', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.keyDown(window, { key: 'Alt' });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 300 });

    expect(screen.queryByTestId('wall-preview')).toBeNull();
  });

  it('does not label an ordinary snapped start as Alt continuation', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 500 });

    expect(screen.queryByText('续画已激活')).toBeNull();
  });

  it('does not use Alt as the free-direction modifier', () => {
    useEditorStore.getState().setTool('interior_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerMove(canvas, {
      clientX: 300,
      clientY: 360,
      altKey: true,
    });

    const preview = screen.getByTestId('wall-preview');
    expect(preview.getAttribute('x2')).toBe('2000');
    expect(preview.getAttribute('y2')).toBe('1000');
  });

  it('offers three explicit direction modes with selected state', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);

    const orthogonal = screen.getByRole('button', { name: '正交' });
    const diagonal = screen.getByRole('button', { name: '45 度' });
    const free = screen.getByRole('button', { name: '自由' });
    expect(orthogonal.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(diagonal);
    expect(useEditorStore.getState().directionMode).toBe('diagonal45');
    expect(diagonal.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(free);
    expect(useEditorStore.getState().directionMode).toBe('free');
    expect(free.getAttribute('aria-pressed')).toBe('true');
  });

  it('uses diagonal and free direction modes for the next pointer move', () => {
    useEditorStore.getState().setTool('interior_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });

    fireEvent.click(screen.getByRole('button', { name: '45 度' }));
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 330 });
    let preview = screen.getByTestId('wall-preview');
    expect(
      Number(preview.getAttribute('x2')) - 1000,
    ).toBeCloseTo(Number(preview.getAttribute('y2')) - 1000, 0);

    fireEvent.click(screen.getByRole('button', { name: '自由' }));
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 330 });
    preview = screen.getByTestId('wall-preview');
    expect(preview.getAttribute('x2')).toBe('2000');
    expect(preview.getAttribute('y2')).toBe('1700');
  });

  it.each([
    ['orthogonal', '2000', '1000'],
    ['diagonal45', '1850', '1850'],
    ['free', '2000', '1700'],
  ] as const)(
    'keeps grid snap under %s direction control for preview and commit',
    (mode, expectedX, expectedY) => {
      useEditorStore.getState().setTool('interior_wall');
      useEditorStore.getState().setDirectionMode(mode);
      render(<SvgCanvas />);
      const canvas = screen.getByTestId('svg-canvas');
      fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
      fireEvent.pointerMove(canvas, { clientX: 300, clientY: 330 });
      const preview = screen.getByTestId('wall-preview');
      expect(screen.getByTestId('snap-marker-grid')).toBeTruthy();
      expect(preview.getAttribute('x2')).toBe(expectedX);
      expect(preview.getAttribute('y2')).toBe(expectedY);

      fireEvent.pointerDown(canvas, { clientX: 300, clientY: 330 });

      const next = useEditorStore.getState().buildingDocument!;
      const added = Object.entries(next.walls).find(
        ([wallId]) => wallId !== 'w_1',
      )![1];
      const end = next.vertices[added.end_vertex_id];
      expect(end).toEqual({
        x_mm: Number(expectedX),
        y_mm: Number(expectedY),
      });
    },
  );

  it('preserves an external transaction when Enter commits in the same turn', () => {
    useEditorStore.getState().setTool('exterior_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 400 });

    act(() => {
      useEditorStore.getState().transact('external metadata', (document) => ({
        ...document,
        metadata: { ...document.metadata, revision: 23 },
      }));
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    const next = useEditorStore.getState().buildingDocument!;
    expect(next.metadata.revision).toBe(23);
    expect(Object.keys(next.walls)).toHaveLength(2);
    expect(useEditorStore.getState().undoStack).toHaveLength(2);
  });

  it('keeps the external document and ends drawing when rebased topology fails', () => {
    useEditorStore.getState().setTool('exterior_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 400 });

    act(() => {
      useEditorStore.getState().transact('external duplicate', (document) => ({
        ...document,
        vertices: {
          ...document.vertices,
          v_duplicate_start: { x_mm: 1000, y_mm: 1000 },
          v_duplicate_end: { x_mm: 2000, y_mm: 1000 },
        },
        walls: {
          ...document.walls,
          w_duplicate: {
            start_vertex_id: 'v_duplicate_start',
            end_vertex_id: 'v_duplicate_end',
            wall_type: 'exterior',
            thickness_mm: 370,
            height_mm: 3000,
            material_type: 'brick',
          },
        },
        floors: [
          {
            ...document.floors[0],
            wall_ids: [...document.floors[0].wall_ids, 'w_duplicate'],
          },
        ],
      }));
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    expect(useEditorStore.getState().buildingDocument!.walls.w_duplicate)
      .toBeDefined();
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    expect(screen.queryByTestId('wall-preview')).toBeNull();
    expect(screen.getByText(/墙体与已有墙重复/)).toBeTruthy();
  });

  it('draws independent polyline segments until Escape', () => {
    useEditorStore.getState().setTool('polyline_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 400 });
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 300 });

    const next = useEditorStore.getState().buildingDocument!;
    const addedWalls = Object.entries(next.walls).filter(
      ([wallId]) => wallId !== 'w_1',
    );
    expect(addedWalls).toHaveLength(2);
    expect(addedWalls[0][1].end_vertex_id).toBe(
      addedWalls[1][1].start_vertex_id,
    );
    expect(screen.getByTestId('wall-preview')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('wall-preview')).toBeNull();
  });

  it('undoes only the latest polyline segment and clears a ghost start', () => {
    useEditorStore.getState().setTool('polyline_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 400 });
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 300 });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    expect(
      Object.keys(useEditorStore.getState().buildingDocument!.walls),
    ).toHaveLength(2);
    expect(screen.queryByTestId('wall-preview')).toBeNull();
  });

  it('clears the continuation anchor when the tool changes', () => {
    useEditorStore.getState().setTool('exterior_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 400 });
    expect(screen.getByText('按住 Alt 从最近终点续画')).toBeTruthy();

    act(() => useEditorStore.getState().setTool('interior_wall'));

    expect(
      screen.queryByText('按住 Alt 从最近终点续画'),
    ).toBeNull();
  });

  it('clears Alt continuation readiness on window blur', () => {
    useEditorStore.getState().setTool('exterior_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 400 });

    fireEvent.keyDown(window, { key: 'Alt' });
    fireEvent.blur(window);
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 300 });

    expect(screen.queryByTestId('wall-preview')).toBeNull();
  });

  it('ends an activated Alt continuation on blur and ignores Enter', () => {
    useEditorStore.getState().setTool('exterior_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 400 });
    fireEvent.keyDown(window, { key: 'Alt' });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 300 });
    expect(screen.getByTestId('wall-preview')).toBeTruthy();

    fireEvent.blur(window);
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(screen.queryByTestId('wall-preview')).toBeNull();
    expect(
      screen.queryByText('按住 Alt 从最近终点续画'),
    ).toBeNull();
    expect(
      Object.keys(useEditorStore.getState().buildingDocument!.walls),
    ).toHaveLength(2);
  });

  it('ends an active polyline command on blur', () => {
    useEditorStore.getState().setTool('polyline_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    expect(screen.getByTestId('wall-preview')).toBeTruthy();

    fireEvent.blur(window);

    expect(screen.queryByTestId('wall-preview')).toBeNull();
  });

  it('ends polyline after undo even when its start vertex still exists', () => {
    useEditorStore.getState().setTool('polyline_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerDown(canvas, { clientX: 400, clientY: 500 });
    expect(screen.getByTestId('wall-preview')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    expect(useEditorStore.getState().buildingDocument!.vertices.v_2).toEqual({
      x_mm: 3000,
      y_mm: 0,
    });
    expect(screen.queryByTestId('wall-preview')).toBeNull();
  });

  it('clears an anchor when autosave replaces the document with equal ids', () => {
    useEditorStore.getState().setTool('exterior_wall');
    act(() => useEditorStore.getState().setSnapMode('none'));
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 400 });
    expect(screen.getByText('按住 Alt 从最近终点续画')).toBeTruthy();

    act(() =>
      useEditorStore
        .getState()
        .finishBuildingSave(
          structuredClone(useEditorStore.getState().buildingDocument!),
        ),
    );

    expect(
      screen.queryByText('按住 Alt 从最近终点续画'),
    ).toBeNull();
  });

  it('clears drawing when load replaces the document with equal ids', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 500 });
    expect(screen.getByTestId('wall-preview')).toBeTruthy();

    act(() =>
      useEditorStore
        .getState()
        .loadBuilding(
          structuredClone(useEditorStore.getState().buildingDocument!),
        ),
    );

    expect(screen.queryByTestId('wall-preview')).toBeNull();
  });

  it('lets wall-tool clicks on a wall hit line reach the canvas', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);

    fireEvent.pointerDown(screen.getByTestId('wall-hit-w_1'), {
      clientX: 300,
      clientY: 500,
    });

    expect(screen.getByTestId('wall-preview')).toBeTruthy();
  });

  it('still selects a wall through its hit line in select mode', () => {
    render(<SvgCanvas />);

    fireEvent.pointerDown(screen.getByTestId('wall-hit-w_1'));

    expect(useEditorStore.getState().selection).toEqual({
      type: 'wall',
      id: 'w_1',
    });
  });

  it('renders faces below walls and selects a face without clearing it on the canvas', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices.v_3 = { x_mm: 3000, y_mm: 2000 };
    document.vertices.v_4 = { x_mm: 0, y_mm: 2000 };
    document.faces.face_1 = {
      boundary_vertex_ids: ['v_1', 'v_2', 'v_3', 'v_4'],
      area_mm2: 6_000_000,
      function_code: 'living_room',
      display_name: '堂屋/客厅',
      color: '#f2c879',
      local_name: '',
    };
    document.floors[0].face_ids = ['face_1'];
    useEditorStore.getState().loadBuilding(document);
    render(<SvgCanvas />);

    const face = screen.getByTestId('face-polygon-face_1');
    const wall = screen.getByTestId('wall-polygon-w_1');
    expect(
      face.compareDocumentPosition(wall) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.pointerDown(face);
    expect(useEditorStore.getState().selection).toEqual({
      type: 'face',
      id: 'face_1',
    });

    fireEvent.pointerDown(screen.getByTestId('wall-hit-w_1'));
    expect(useEditorStore.getState().selection).toEqual({
      type: 'wall',
      id: 'w_1',
    });
  });

  it('starts a middle-button pan from inside a face without selecting it', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices.v_3 = { x_mm: 3000, y_mm: 2000 };
    document.vertices.v_4 = { x_mm: 0, y_mm: 2000 };
    document.faces.face_1 = {
      boundary_vertex_ids: ['v_1', 'v_2', 'v_3', 'v_4'],
      area_mm2: 6_000_000,
      function_code: null,
      display_name: '堂屋',
      color: '#f2c879',
      local_name: '',
    };
    useEditorStore.getState().loadBuilding(document);
    const before = useEditorStore.getState().viewport;
    render(<SvgCanvas />);
    const face = screen.getByTestId('face-polygon-face_1');

    fireEvent.pointerDown(face, {
      button: 1,
      pointerId: 7,
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerMove(screen.getByTestId('svg-canvas'), {
      pointerId: 7,
      clientX: 340,
      clientY: 320,
    });

    expect(useEditorStore.getState().viewport).not.toEqual(before);
    expect(useEditorStore.getState().selection).toBeNull();
  });

  it('starts a Space-left pan from inside a face without selecting it', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices.v_3 = { x_mm: 3000, y_mm: 2000 };
    document.vertices.v_4 = { x_mm: 0, y_mm: 2000 };
    document.faces.face_1 = {
      boundary_vertex_ids: ['v_1', 'v_2', 'v_3', 'v_4'],
      area_mm2: 6_000_000,
      function_code: null,
      display_name: '堂屋',
      color: '#f2c879',
      local_name: '',
    };
    useEditorStore.getState().loadBuilding(document);
    const before = useEditorStore.getState().viewport;
    render(<SvgCanvas />);
    const face = screen.getByTestId('face-polygon-face_1');

    fireEvent.keyDown(window, { code: 'Space' });
    fireEvent.pointerDown(face, {
      button: 0,
      pointerId: 8,
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerMove(screen.getByTestId('svg-canvas'), {
      pointerId: 8,
      clientX: 340,
      clientY: 320,
    });
    fireEvent.keyUp(window, { code: 'Space' });

    expect(useEditorStore.getState().viewport).not.toEqual(before);
    expect(useEditorStore.getState().selection).toBeNull();
  });

  it('splits a host wall when a new wall ends on its middle projection', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 300 });
    fireEvent.pointerDown(screen.getByTestId('wall-hit-w_1'), {
      clientX: 350,
      clientY: 500,
    });

    const document = useEditorStore.getState().buildingDocument!;
    expect(document.walls.w_1).toBeUndefined();
    expect(Object.keys(document.walls)).toHaveLength(3);
    expect(
      Object.values(document.vertices).filter(
        (vertex) =>
          vertex.x_mm > 0 &&
          vertex.x_mm < 3000 &&
          vertex.y_mm === 0,
      ),
    ).toHaveLength(1);
  });

  it('uses the full clicked snap target for an untyped endpoint', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices.v_bottom = { x_mm: 1500, y_mm: -1000 };
    document.vertices.v_top = { x_mm: 1500, y_mm: 1000 };
    document.walls.w_vertical = {
      start_vertex_id: 'v_bottom',
      end_vertex_id: 'v_top',
      wall_type: 'interior',
      thickness_mm: 240,
      height_mm: 3000,
      material_type: 'brick',
    };
    document.floors[0].wall_ids.push('w_vertical');
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 400 });
    fireEvent.pointerDown(canvas, { clientX: 250, clientY: 500 });

    const next = useEditorStore.getState().buildingDocument!;
    const intersectionId = Object.entries(next.vertices).find(
      ([, vertex]) => vertex.x_mm === 1500 && vertex.y_mm === 0,
    )?.[0];
    expect(intersectionId).toBeDefined();
    expect(
      Object.values(next.walls).some(
        (wall) =>
          wall.start_vertex_id === intersectionId ||
          wall.end_vertex_id === intersectionId,
      ),
    ).toBe(true);
  });

  it('keeps the preview on the full snap target before click commit', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices.v_target = { x_mm: 1500, y_mm: 0 };
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 400 });
    fireEvent.pointerMove(canvas, { clientX: 250, clientY: 500 });

    const preview = screen.getByTestId('wall-preview');
    expect(screen.getByTestId('snap-marker-vertex')).toBeTruthy();
    expect(preview.getAttribute('x2')).toBe('1500');
    expect(preview.getAttribute('y2')).toBe('0');

    fireEvent.pointerDown(canvas, { clientX: 250, clientY: 500 });

    const next = useEditorStore.getState().buildingDocument!;
    const targetId = Object.entries(next.vertices).find(
      ([, vertex]) => vertex.x_mm === 1500 && vertex.y_mm === 0,
    )?.[0];
    const addedWall = Object.entries(next.walls).find(
      ([wallId]) => wallId !== 'w_1',
    )?.[1];
    expect(addedWall).toBeDefined();
    expect([
      addedWall!.start_vertex_id,
      addedWall!.end_vertex_id,
    ]).toContain(targetId);
  });

  it('keeps a typed endpoint exact when a vertex is more than 1 mm away', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices.v_near = { x_mm: 4503, y_mm: 1000 };
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setTool('exterior_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 400 });
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 400 });
    fireEvent.keyDown(window, { key: '4' });
    fireEvent.keyDown(window, { key: '.' });
    fireEvent.keyDown(window, { key: '5' });
    fireEvent.keyDown(window, { key: 'Enter' });

    const next = useEditorStore.getState().buildingDocument!;
    expect(
      Object.values(next.vertices).some(
        (vertex) => vertex.x_mm === 4500 && vertex.y_mm === 1000,
      ),
    ).toBe(true);
  });

  it('shows distinct snap markers and the current snap status', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 500 });

    expect(screen.getByTestId('snap-marker-vertex')).toBeTruthy();
    expect(screen.getByTestId('snap-status').textContent).toContain('顶点');
    expect(screen.getByTestId('snap-status').textContent).toContain('(0, 0)');
  });

  it('finds and displays a snap while the wall tool is still idle', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);

    fireEvent.pointerMove(screen.getByTestId('svg-canvas'), {
      clientX: 100,
      clientY: 500,
    });

    expect(screen.getByTestId('snap-marker-vertex')).toBeTruthy();
    expect(screen.queryByTestId('wall-preview')).toBeNull();
  });

  it('clears a stale snap immediately when snap mode is disabled', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    fireEvent.pointerMove(screen.getByTestId('svg-canvas'), {
      clientX: 100,
      clientY: 500,
    });
    expect(screen.getByLabelText('顶点吸附')).toBeTruthy();

    act(() => useEditorStore.getState().setSnapMode('none'));

    expect(screen.queryByLabelText('顶点吸附')).toBeNull();
    expect(screen.queryByTestId('snap-status')).toBeNull();
  });

  it('clears a stale snap immediately when the document is replaced', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    fireEvent.pointerMove(screen.getByTestId('svg-canvas'), {
      clientX: 100,
      clientY: 500,
    });
    expect(screen.getByLabelText('顶点吸附')).toBeTruthy();

    act(() =>
      useEditorStore.getState().loadBuilding(
        structuredClone(useEditorStore.getState().buildingDocument!),
      ),
    );

    expect(screen.queryByLabelText('顶点吸附')).toBeNull();
    expect(screen.queryByTestId('snap-status')).toBeNull();
  });

  it('clears a stale snap immediately when the tool changes', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    fireEvent.pointerMove(screen.getByTestId('svg-canvas'), {
      clientX: 100,
      clientY: 500,
    });
    expect(screen.getByLabelText('顶点吸附')).toBeTruthy();

    act(() => useEditorStore.getState().setTool('select'));

    expect(screen.queryByLabelText('顶点吸附')).toBeNull();
    expect(screen.queryByTestId('snap-status')).toBeNull();
  });

  it('records a split wall insertion as one undo entry and restores it once', () => {
    useEditorStore.getState().setTool('interior_wall');
    const before = structuredClone(
      useEditorStore.getState().buildingDocument!,
    );
    const undoCount = useEditorStore.getState().undoStack.length;
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 300 });
    fireEvent.pointerDown(screen.getByTestId('wall-hit-w_1'), {
      clientX: 350,
      clientY: 500,
    });

    expect(useEditorStore.getState().undoStack).toHaveLength(undoCount + 1);
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().buildingDocument).toEqual(before);
  });

  it('places a wall element from the clicked world projection as one undo transaction', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices.v_3 = { x_mm: 0, y_mm: 2000 };
    document.faces.room = {
      boundary_vertex_ids: ['v_1', 'v_2', 'v_3'],
      area_mm2: 3_000_000,
      function_code: null,
      display_name: 'Room',
      color: '#fff',
      local_name: '',
    };
    document.floors[0].face_ids = ['room'];
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setTool('exterior_window');
    const before = structuredClone(useEditorStore.getState().buildingDocument!);
    render(<SvgCanvas />);

    fireEvent.pointerDown(screen.getByTestId('wall-hit-w_1'), {
      button: 0,
      clientX: 250,
      clientY: 500,
    });

    const next = useEditorStore.getState().buildingDocument!;
    expect(Object.values(next.wall_elements)).toContainEqual(
      expect.objectContaining({
        element_type: 'exterior_window',
        host_wall_id: 'w_1',
        offset_from_start_mm: 900,
        width_mm: 1200,
      }),
    );
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().buildingDocument).toEqual(before);
  });

  it('selects a rendered wall element in select mode', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.wall_elements.element = {
      element_type: 'exterior_door',
      host_wall_id: 'w_1',
      offset_from_start_mm: 1000,
      width_mm: 900,
      height_mm: 2100,
      sill_height_mm: 0,
      status: 'valid',
    };
    useEditorStore.getState().loadBuilding(document);
    render(<SvgCanvas />);

    fireEvent.pointerDown(screen.getByTestId('wall-element-hit-element'), {
      button: 0,
    });
    expect(useEditorStore.getState().selection).toEqual({
      type: 'wall_element',
      id: 'element',
    });
  });

  it('starts a Space-left pan from a wall element without selecting it', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.wall_elements.element = {
      element_type: 'exterior_window',
      host_wall_id: 'w_1',
      offset_from_start_mm: 1000,
      width_mm: 1000,
      height_mm: 1200,
      sill_height_mm: 900,
      status: 'valid',
    };
    useEditorStore.getState().loadBuilding(document);
    const before = useEditorStore.getState().viewport;
    render(<SvgCanvas />);

    fireEvent.keyDown(window, { code: 'Space' });
    fireEvent.pointerDown(screen.getByTestId('wall-element-hit-element'), {
      button: 0,
      pointerId: 19,
      clientX: 300,
      clientY: 500,
    });
    fireEvent.pointerMove(screen.getByTestId('svg-canvas'), {
      pointerId: 19,
      clientX: 340,
      clientY: 520,
    });
    fireEvent.keyUp(window, { code: 'Space' });

    expect(useEditorStore.getState().viewport).not.toEqual(before);
    expect(useEditorStore.getState().selection).toBeNull();
  });

  it('ignores move and up events from a non-active pan pointer', () => {
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    const before = useEditorStore.getState().viewport;

    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 1,
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 2,
      clientX: 350,
      clientY: 350,
    });
    fireEvent.pointerUp(canvas, { pointerId: 2 });
    expect(useEditorStore.getState().viewport).toEqual(before);

    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: 320,
      clientY: 300,
    });
    expect(useEditorStore.getState().viewport).not.toEqual(before);
  });

  it('clears a stuck Space pan gesture when the window loses focus', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.keyDown(window, { code: 'Space' });
    fireEvent.blur(window);
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      clientX: 200,
      clientY: 400,
    });

    expect(screen.getByTestId('wall-preview')).toBeTruthy();
  });

  it('cancels the active preview with Escape', () => {
    useEditorStore.getState().setTool('interior_wall');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 400 });
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 360 });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('wall-preview')).toBeNull();
  });

  it('zooms the viewport without changing document coordinates', () => {
    render(<SvgCanvas />);
    const before = structuredClone(
      useEditorStore.getState().buildingDocument!.vertices,
    );
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.wheel(canvas, {
      clientX: 400,
      clientY: 300,
      deltaY: -100,
    });

    expect(useEditorStore.getState().viewport.pixelsPerMm).toBeGreaterThan(0.1);
    expect(useEditorStore.getState().buildingDocument!.vertices).toEqual(
      before,
    );
  });

  it('translates the reference image in adjust mode without moving walls', () => {
    useEditorStore.getState().setTool('adjust_reference');
    const beforeVertices = structuredClone(
      useEditorStore.getState().buildingDocument!.vertices,
    );
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      clientX: 200,
      clientY: 400,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: 250,
      clientY: 380,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      clientX: 250,
      clientY: 380,
    });

    const document = useEditorStore.getState().buildingDocument!;
    expect(document.reference_image.transform).toMatchObject({
      translate_x_mm: 500,
      translate_y_mm: 200,
    });
    expect(document.vertices).toEqual(beforeVertices);
  });

  it('renders scale handles only in adjust-reference mode', () => {
    useEditorStore.getState().setTool('adjust_reference');
    render(<SvgCanvas />);

    expect(
      screen.getByTestId('reference-scale-handle-hit-br'),
    ).toBeTruthy();

    act(() => useEditorStore.getState().setTool('select'));
    expect(screen.queryByTestId('reference-scale-handle-hit-br')).toBeNull();
  });

  it('scales the reference image by dragging its bottom-right handle', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.reference_image.width_px = 400;
    document.reference_image.height_px = 200;
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setTool('adjust_reference');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    fireEvent.pointerDown(screen.getByTestId('reference-scale-handle-hit-br'), {
      pointerId: 5,
      clientX: 140,
      clientY: 480,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 5,
      clientX: 160,
      clientY: 470,
    });

    // 拖拽过程中预览实时缩放
    const previewGroup =
      screen.getByTestId('reference-image').parentElement!;
    expect(previewGroup.getAttribute('transform')).toBe(
      'translate(0 0) rotate(0) scale(1.5)',
    );

    fireEvent.pointerUp(canvas, { pointerId: 5, clientX: 160, clientY: 470 });

    const next = useEditorStore.getState().buildingDocument!;
    expect(next.reference_image.transform).toMatchObject({
      translate_x_mm: 0,
      translate_y_mm: 0,
      scale: 1.5,
    });
  });

  it('scales a rotated reference image around the opposite corner', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.reference_image.width_px = 400;
    document.reference_image.height_px = 200;
    document.reference_image.transform.rotation_deg = 90;
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setTool('adjust_reference');
    render(<SvgCanvas />);
    const canvas = screen.getByTestId('svg-canvas');

    // tl 角点（世界坐标 (0,0)），绕对角的 br 锚点缩放
    fireEvent.pointerDown(screen.getByTestId('reference-scale-handle-hit-tl'), {
      pointerId: 6,
      clientX: 100,
      clientY: 500,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 6,
      clientX: 110,
      clientY: 520,
    });
    fireEvent.pointerUp(canvas, { pointerId: 6, clientX: 110, clientY: 520 });

    const next = useEditorStore.getState().buildingDocument!;
    const { translate_x_mm, translate_y_mm, scale, rotation_deg } =
      next.reference_image.transform;
    expect(translate_x_mm).toBeCloseTo(100);
    expect(translate_y_mm).toBeCloseTo(-200);
    expect(scale).toBeCloseTo(1.5);
    expect(rotation_deg).toBe(90);
  });
});
