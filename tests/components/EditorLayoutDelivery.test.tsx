import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorLayout } from '../../src/editor/EditorLayout.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';
import * as projectApi from '../../src/api/projectApi.ts';

vi.mock('../../src/api/projectApi.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/projectApi.ts')>();
  return {
    ...actual,
    exportProject: vi.fn(),
    openProjectFolder: vi.fn(),
  };
});

describe('EditorLayout delivery actions', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    useEditorStore
      .getState()
      .loadBuilding(
        createEmptyBuilding('house_0001', 'reference/original.png'),
      );
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('submits the current document through the async export API', async () => {
    const document = useEditorStore.getState().buildingDocument!;
    vi.mocked(projectApi.exportProject).mockResolvedValue({
      document,
      revision: 0,
      blob: new Blob(['zip'], { type: 'application/zip' }),
    });

    render(<EditorLayout />);
    fireEvent.click(
      screen.getByRole('button', { name: '导出建筑包' }),
    );

    await waitFor(() => {
      expect(projectApi.exportProject).toHaveBeenCalledWith(
        'house_0001',
        document,
        { scale: '1:200', scaleBar: false },
      );
    });
  });

  it('opens the current building folder from the editor header', async () => {
    vi.mocked(projectApi.openProjectFolder).mockResolvedValue();
    render(<EditorLayout />);

    fireEvent.click(screen.getByRole('button', { name: '📁 打开文件夹' }));

    await waitFor(() => {
      expect(projectApi.openProjectFolder).toHaveBeenCalledWith('house_0001');
    });
  });
});
