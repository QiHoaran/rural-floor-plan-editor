import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { useServerAutoSave } from '../../src/editor/hooks/useServerAutoSave.ts';
import * as projectApi from '../../src/api/projectApi.ts';

vi.mock('../../src/api/projectApi.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/api/projectApi.ts')>(
      '../../src/api/projectApi.ts',
    );
  return {
    ...actual,
    autosaveProject: vi.fn(),
  };
});

describe('useServerAutoSave', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('flushes pending changes before leaving without waiting for debounce', async () => {
    vi.useFakeTimers();
    const document = createEmptyBuilding('flush_house', '');
    vi.mocked(projectApi.autosaveProject).mockResolvedValue(document);
    const { result, rerender } = renderHook(({ version }) => useServerAutoSave({
      buildingId: 'flush_house', document, changeVersion: version,
      onSaving: vi.fn(), onSaved: vi.fn(), onError: vi.fn(),
    }), { initialProps: { version: 0 } });
    rerender({ version: 1 });
    await act(async () => { await result.current(); });
    expect(projectApi.autosaveProject).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(projectApi.autosaveProject).toHaveBeenCalledTimes(1);
  });

  it('rejects a failed flush and allows retry without losing pending changes', async () => {
    vi.useFakeTimers();
    const document = createEmptyBuilding('retry_house', '');
    vi.mocked(projectApi.autosaveProject).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(document);
    const { result, rerender } = renderHook(({ version }) => useServerAutoSave({
      buildingId: 'retry_house', document, changeVersion: version,
      onSaving: vi.fn(), onSaved: vi.fn(), onError: vi.fn(),
    }), { initialProps: { version: 0 } });
    rerender({ version: 1 });
    await act(async () => { await expect(result.current()).rejects.toThrow('offline'); });
    await act(async () => { await result.current(); });
    expect(projectApi.autosaveProject).toHaveBeenCalledTimes(2);
  });

  it('continues saving after a workflow reload resets the local change counter', async () => {
    vi.useFakeTimers();
    const document = createEmptyBuilding('workflow_house', '');
    vi.mocked(projectApi.autosaveProject).mockResolvedValue(document);
    const { result, rerender } = renderHook(({ version }) => useServerAutoSave({
      buildingId: 'workflow_house', document, changeVersion: version,
      onSaving: vi.fn(), onSaved: vi.fn(), onError: vi.fn(),
    }), { initialProps: { version: 0 } });
    rerender({ version: 1 });
    await act(async () => { await result.current(); });
    rerender({ version: 0 });
    rerender({ version: 1 });
    await act(async () => { await result.current(); });
    expect(projectApi.autosaveProject).toHaveBeenCalledTimes(2);
  });

  it('saves once after the 800 ms debounce', async () => {
    vi.useFakeTimers();
    const document = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    );
    const saved = {
      ...document,
      metadata: { ...document.metadata, revision: 1 },
    };
    vi.mocked(projectApi.autosaveProject).mockResolvedValue(saved);
    const onSaving = vi.fn();
    const onSaved = vi.fn();
    const onError = vi.fn();

    const { rerender } = renderHook(
      ({ changeVersion }) =>
        useServerAutoSave({
          buildingId: 'house_0001',
          document,
          changeVersion,
          onSaving,
          onSaved,
          onError,
        }),
      { initialProps: { changeVersion: 0 } },
    );

    rerender({ changeVersion: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(projectApi.autosaveProject).toHaveBeenCalledTimes(1);
    expect(onSaving).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(saved, 1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports failure without replacing the in-memory document', async () => {
    vi.useFakeTimers();
    const document = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    );
    const error = new Error('offline');
    vi.mocked(projectApi.autosaveProject).mockRejectedValue(error);
    const onSaved = vi.fn();
    const onError = vi.fn();

    const { rerender } = renderHook(
      ({ changeVersion }) =>
        useServerAutoSave({
          buildingId: 'house_0001',
          document,
          changeVersion,
          onSaving: vi.fn(),
          onSaved,
          onError,
        }),
      { initialProps: { changeVersion: 0 } },
    );

    rerender({ changeVersion: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('does not save again when the server response replaces the document at the same change version', async () => {
    vi.useFakeTimers();
    const document = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    );
    const saved = {
      ...document,
      metadata: { ...document.metadata, revision: 1 },
    };
    vi.mocked(projectApi.autosaveProject).mockResolvedValue(saved);

    const { rerender } = renderHook(
      ({ currentDocument, changeVersion }) =>
        useServerAutoSave({
          buildingId: 'house_0001',
          document: currentDocument,
          changeVersion,
          onSaving: vi.fn(),
          onSaved: vi.fn(),
          onError: vi.fn(),
        }),
      {
        initialProps: {
          currentDocument: document,
          changeVersion: 1,
        },
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    rerender({ currentDocument: saved, changeVersion: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(projectApi.autosaveProject).toHaveBeenCalledTimes(1);
  });

  it('serializes a newer edit behind an in-flight save and rebases its revision', async () => {
    vi.useFakeTimers();
    const first = createEmptyBuilding('house_0001', 'reference/original.png');
    const second = {
      ...first,
      vertices: { newest: { x_mm: 2, y_mm: 2 } },
    };
    let resolveFirst!: (document: typeof first) => void;
    vi.mocked(projectApi.autosaveProject)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(async (document) => ({
        ...document,
        metadata: { ...document.metadata, revision: 2 },
      }));

    const { rerender } = renderHook(
      ({ currentDocument, changeVersion }) =>
        useServerAutoSave({
          buildingId: 'house_0001',
          document: currentDocument,
          changeVersion,
          onSaving: vi.fn(),
          onSaved: (saved, savedVersion) =>
            savedVersion === changeVersion
              ? saved
              : {
                  ...currentDocument,
                  metadata: {
                    ...currentDocument.metadata,
                    revision: saved.metadata.revision,
                    updated_at: saved.metadata.updated_at,
                  },
                },
          onError: vi.fn(),
        }),
      { initialProps: { currentDocument: first, changeVersion: 1 } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    rerender({ currentDocument: second, changeVersion: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(projectApi.autosaveProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ ...first, metadata: { ...first.metadata, revision: 1 } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(projectApi.autosaveProject).toHaveBeenCalledTimes(2);
    const queuedDocument = vi.mocked(projectApi.autosaveProject).mock.calls[1][1];
    expect(queuedDocument.metadata.revision).toBe(1);
    expect(queuedDocument.vertices.newest).toEqual({ x_mm: 2, y_mm: 2 });
  });
});
