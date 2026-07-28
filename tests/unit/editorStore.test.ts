import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';

describe('editorStore document transactions', () => {
  beforeEach(() => {
    useEditorStore.getState().closeBuilding();
    useEditorStore.getState().setDirectionMode('orthogonal');
    useEditorStore
      .getState()
      .loadBuilding(
        createEmptyBuilding('house_0001', 'reference/original.png'),
      );
  });

  it('applies a transaction and records one undo step', () => {
    useEditorStore.getState().transact('添加顶点', (document) => ({
      ...document,
      vertices: {
        ...document.vertices,
        v_1: { x_mm: 1000, y_mm: 2000 },
      },
    }));

    const state = useEditorStore.getState();
    expect(state.buildingDocument?.vertices.v_1).toEqual({
      x_mm: 1000,
      y_mm: 2000,
    });
    expect(state.changeVersion).toBe(1);
    expect(state.undoStack).toHaveLength(1);
    expect(state.redoStack).toHaveLength(0);
    expect(state.buildingSaveStatus).toBe('unsaved');
  });

  it('undoes and redoes document transactions', () => {
    useEditorStore.getState().transact('添加顶点', (document) => ({
      ...document,
      vertices: {
        ...document.vertices,
        v_1: { x_mm: 1000, y_mm: 2000 },
      },
    }));

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().buildingDocument?.vertices).toEqual({});

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().buildingDocument?.vertices.v_1).toEqual(
      { x_mm: 1000, y_mm: 2000 },
    );
  });

  it('keeps view changes out of document history', () => {
    useEditorStore.getState().setViewport({
      originXmm: -1000,
      originYmm: 500,
      pixelsPerMm: 0.15,
    });

    const state = useEditorStore.getState();
    expect(state.viewport.originXmm).toBe(-1000);
    expect(state.undoStack).toHaveLength(0);
    expect(state.changeVersion).toBe(0);
  });

  it('stores an explicit direction mode and defaults to orthogonal', () => {
    expect(useEditorStore.getState().directionMode).toBe('orthogonal');

    useEditorStore.getState().setDirectionMode('diagonal45');
    expect(useEditorStore.getState().directionMode).toBe('diagonal45');

    useEditorStore.getState().setDirectionMode('free');
    expect(useEditorStore.getState().directionMode).toBe('free');
  });
});
