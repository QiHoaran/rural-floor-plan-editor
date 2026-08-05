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
    downloadProjectArchive: vi.fn(),
  };
});

vi.mock('../../src/projects/imageFile.ts', () => ({
  readImageFile: vi.fn(),
}));

describe('ProjectHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectApi.listProjects).mockResolvedValue([]);
    vi.mocked(projectApi.listTrashedProjects).mockResolvedValue([]);
    vi.mocked(projectApi.createProject).mockReset();
    vi.mocked(projectApi.trashProject).mockResolvedValue();
    vi.mocked(projectApi.downloadProjectArchive).mockResolvedValue(
      new Blob(['zip'], { type: 'application/zip' }),
    );
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

  it('selects cards without opening them and reports partial batch deletion', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(projectApi.listProjects).mockResolvedValue([
      projectSummary('house_0001'),
      projectSummary('house_0002'),
    ]);
    vi.mocked(projectApi.trashProject)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('busy'));
    const onOpen = vi.fn();
    render(<ProjectHome onOpen={onOpen} />);

    fireEvent.click(await screen.findByLabelText('选择 house_0001'));
    fireEvent.click(screen.getByLabelText('选择 house_0002'));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText('已选 2 栋')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }));

    await waitFor(() => {
      expect(projectApi.trashProject).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/已删除 1 栋，1 栋失败：house_0002/)).toBeTruthy();
    });
  });

  it('exports every selected building with the default research scale', async () => {
    vi.mocked(projectApi.listProjects).mockResolvedValue([
      projectSummary('house_0001'),
      projectSummary('house_0002'),
    ]);
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    render(<ProjectHome onOpen={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '全选' }));
    fireEvent.click(screen.getByRole('button', { name: '批量导出' }));

    await waitFor(() => {
      expect(projectApi.downloadProjectArchive).toHaveBeenCalledTimes(2);
      expect(projectApi.downloadProjectArchive).toHaveBeenCalledWith(
        'house_0001',
        { scale: '1:200', scaleBar: false },
      );
      expect(screen.getByText('已导出 2 栋建筑。')).toBeTruthy();
    });
  });
});

function projectSummary(buildingId: string): projectApi.ProjectSummary {
  return {
    building_id: buildingId,
    name: buildingId,
    updated_at: '2026-07-27T01:00:00.000Z',
    status: 'draft',
    revision: 0,
    room_count: 0,
    total_floor_area_m2: 0,
    geometry_progress: 0,
    room_semantic_progress: 0,
    opening_progress: 100,
    validation_error_count: 0,
    validation_warning_count: 0,
  };
}
