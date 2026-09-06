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
  uploadReferenceImageFile: vi.fn(),
}));

describe('ProjectHome', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(projectApi.listProjects).mockResolvedValue([]);
    vi.mocked(projectApi.listTrashedProjects).mockResolvedValue([]);
    vi.mocked(projectApi.createProject).mockReset();
    vi.mocked(projectApi.trashProject).mockResolvedValue();
    vi.mocked(projectApi.downloadProjectArchive).mockResolvedValue(
      new Blob(['zip'], { type: 'application/zip' }),
    );
    vi.mocked(imageFile.readImageFile).mockReset();
    vi.mocked(imageFile.uploadReferenceImageFile).mockReset();
  });

  it('shares selection between card and list modes and loads trash only on demand', async () => {
    vi.mocked(projectApi.listProjects).mockResolvedValue([
      { building_id: 'house_10', status: 'draft', updated_at: '', revision: 1 },
      { building_id: 'house_2', status: 'draft', updated_at: '', revision: 1 },
    ] as projectApi.ProjectSummary[]);
    render(<ProjectHome onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText('选择 house_2'));
    fireEvent.click(screen.getByRole('button', { name: '列表' }));
    expect((screen.getByLabelText('选择 house_2') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: '批量检查' }) as HTMLButtonElement).disabled).toBe(false);
    expect(projectApi.listTrashedProjects).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('回收站'));
    await waitFor(() => expect(projectApi.listTrashedProjects).toHaveBeenCalledTimes(1));
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

    fireEvent.click(await screen.findByRole('button', { name: '全选筛选结果' }));
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

  it('renders compact card data and prefers vector previews', async () => {
    vi.mocked(projectApi.listProjects).mockResolvedValue([{
      ...projectSummary('rural_003_house_0001'),
      updated_at: '2026-08-11T01:00:00.000Z',
      status: 'complete',
      room_count: 5,
      total_floor_area_m2: 65,
      room_semantic_progress: 100,
      preview_kind: 'vector',
      has_reference_image: true,
    }]);
    render(<ProjectHome onOpen={vi.fn()} />);

    expect(await screen.findByText('rural_003_house_0001')).toBeTruthy();
    expect(screen.getByText('已完成', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText(/2026年8月11日/)).toBeTruthy();
    expect(screen.getByText('参考图[✓]')).toBeTruthy();
    expect(screen.getByText('房间5')).toBeTruthy();
    expect(screen.getByText('面积65.0m²')).toBeTruthy();
    expect(screen.getByText('标注100%')).toBeTruthy();
    const image = document.querySelector('img');
    expect(image?.getAttribute('src')).toBe('/api/projects/rural_003_house_0001/preview?v=0');
  });

  it('imports one dropped image into an empty project card', async () => {
    const project = projectSummary('house_0003');
    vi.mocked(projectApi.listProjects).mockResolvedValue([project]);
    vi.mocked(imageFile.uploadReferenceImageFile).mockResolvedValue(
      createEmptyBuilding('house_0003', 'reference/original.png'),
    );
    render(<ProjectHome onOpen={vi.fn()} />);
    const title = await screen.findByText('house_0003');
    const card = title.closest('button')!.parentElement!;
    const file = new File(['png'], 'plan.png', { type: 'image/png' });
    fireEvent.drop(card, {
      dataTransfer: { files: [file], types: ['Files'] },
    });
    await waitFor(() => {
      expect(imageFile.uploadReferenceImageFile).toHaveBeenCalledWith('house_0003', file);
      expect(screen.getByText('参考图已导入')).toBeTruthy();
    });
  });

  it('does not overwrite a reference image by card drop', async () => {
    vi.mocked(projectApi.listProjects).mockResolvedValue([{
      ...projectSummary('house_0004'),
      preview_kind: 'reference',
      has_reference_image: true,
    }]);
    render(<ProjectHome onOpen={vi.fn()} />);
    const card = (await screen.findByText('house_0004')).closest('button')!.parentElement!;
    fireEvent.drop(card, {
      dataTransfer: {
        files: [new File(['png'], 'plan.png', { type: 'image/png' })],
        types: ['Files'],
      },
    });
    expect(await screen.findByText('已有参考图，不能覆盖')).toBeTruthy();
    expect(imageFile.uploadReferenceImageFile).not.toHaveBeenCalled();
  });

  it('rejects dropping multiple files onto one card', async () => {
    vi.mocked(projectApi.listProjects).mockResolvedValue([
      projectSummary('house_0005'),
    ]);
    render(<ProjectHome onOpen={vi.fn()} />);
    const card = (await screen.findByText('house_0005')).closest('button')!.parentElement!;
    fireEvent.drop(card, {
      dataTransfer: {
        files: [
          new File(['a'], 'a.png', { type: 'image/png' }),
          new File(['b'], 'b.png', { type: 'image/png' }),
        ],
        types: ['Files'],
      },
    });
    expect(await screen.findByText('请一次拖入一张图片')).toBeTruthy();
    expect(imageFile.uploadReferenceImageFile).not.toHaveBeenCalled();
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
    preview_kind: 'empty',
    has_reference_image: false,
  };
}
