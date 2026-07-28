import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectHome } from '../../src/projects/ProjectHome.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import * as projectApi from '../../src/api/projectApi.ts';
import * as imageFile from '../../src/projects/imageFile.ts';

vi.mock('../../src/api/projectApi.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/api/projectApi.ts')>(
      '../../src/api/projectApi.ts',
    );
  return {
    ...actual,
    listProjects: vi.fn(),
    listTrashedProjects: vi.fn(),
    createProject: vi.fn(),
    trashProject: vi.fn(),
    restoreProject: vi.fn(),
  };
});

vi.mock('../../src/projects/imageFile.ts', () => ({
  readImageFile: vi.fn(),
}));

describe('ProjectHome', () => {
  beforeEach(() => {
    vi.mocked(projectApi.listProjects).mockResolvedValue([]);
    vi.mocked(projectApi.listTrashedProjects).mockResolvedValue([]);
    vi.mocked(projectApi.createProject).mockReset();
    vi.mocked(imageFile.readImageFile).mockReset();
  });

  it('lists projects and opens the selected building', async () => {
    vi.mocked(projectApi.listProjects).mockResolvedValue([
      {
        building_id: 'house_0001',
        updated_at: '2026-07-27T01:00:00.000Z',
        status: 'draft',
      },
    ]);
    const onOpen = vi.fn();
    render(<ProjectHome onOpen={onOpen} />);

    const projectButton = await screen.findByText('house_0001');
    fireEvent.click(projectButton.closest('button')!);

    expect(onOpen).toHaveBeenCalledWith('house_0001');
  });

  it('rejects an empty building ID before calling the API', async () => {
    render(<ProjectHome onOpen={vi.fn()} />);
    fireEvent.click(
      await screen.findByRole('button', { name: '新建建筑' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '创建建筑' }));

    expect(screen.getByText('请输入建筑 ID')).toBeTruthy();
    expect(projectApi.createProject).not.toHaveBeenCalled();
  });

  it('creates a project from a validated ID and reference image', async () => {
    const document = createEmptyBuilding(
      'house_0002',
      'reference/original.png',
    );
    vi.mocked(imageFile.readImageFile).mockResolvedValue({
      image_name: 'sketch.png',
      image_mime: 'image/png',
      image_base64: 'cG5n',
      width_px: 640,
      height_px: 480,
    });
    vi.mocked(projectApi.createProject).mockResolvedValue(document);
    const onOpen = vi.fn();
    render(<ProjectHome onOpen={onOpen} />);
    fireEvent.click(
      await screen.findByRole('button', { name: '新建建筑' }),
    );

    fireEvent.change(screen.getByLabelText('建筑 ID'), {
      target: { value: 'house_0002' },
    });
    fireEvent.change(screen.getByLabelText('参考草图'), {
      target: {
        files: [
          new File(['png'], 'sketch.png', { type: 'image/png' }),
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建建筑' }));

    await waitFor(() => {
      expect(projectApi.createProject).toHaveBeenCalledWith({
        building_id: 'house_0002',
        image_name: 'sketch.png',
        image_mime: 'image/png',
        image_base64: 'cG5n',
        width_px: 640,
        height_px: 480,
        wall_thickness_mm: 240,
      });
    });
    expect(onOpen).toHaveBeenCalledWith('house_0002', document);
  });
});
