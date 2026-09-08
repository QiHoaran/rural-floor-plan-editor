import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversionDialog } from '../../src/projects/ConversionDialog.tsx';
import { CONVERSION_JOB_KEY, CONVERSION_PATH_KEY } from '../../src/projects/conversionStorage.ts';
import * as api from '../../src/api/conversionApi.ts';
import { ApiError, type ProjectSummary } from '../../src/api/projectApi.ts';

vi.mock('../../src/api/conversionApi.ts', () => ({ listConversionFormats: vi.fn(), startConversion: vi.fn(), getConversion: vi.fn(), recoverConversion: vi.fn(), openConversionFolder: vi.fn() }));
const projects = [
  { building_id: 'rural_001_house_0001', revision: 4, status: 'complete' },
  { building_id: 'rural_001_house_0002', revision: 2, status: 'draft' },
] as ProjectSummary[];
const formats = [
  { id: 'graph', label: 'Graph', directory: 'Graph', version: '1', available: true },
  { id: 'image', label: 'Image', directory: 'Image', version: '1', available: true },
  { id: 'cad', label: 'CAD', directory: 'CAD', version: '1', available: true },
  { id: 'embodied', label: 'Embodied', directory: 'Embodied', version: '1', available: true },
];
const queued: api.ConversionJob = { id: 'job1', status: 'queued', outputRoot: 'D:\\转换 结果', items: [{ buildingId: projects[0].building_id, format: 'graph', status: 'queued' }] };
describe('ConversionDialog', () => {
  beforeEach(() => {
    localStorage.clear(); vi.resetAllMocks();
    vi.mocked(api.listConversionFormats).mockResolvedValue({ formats });
    vi.mocked(api.startConversion).mockResolvedValue(queued);
    vi.mocked(api.getConversion).mockResolvedValue(queued);
    vi.mocked(api.openConversionFolder).mockResolvedValue();
  });
  it('starts blank, selects all formats and submits only complete projects with skip as default', async () => {
    render(<ConversionDialog projects={projects} onClose={vi.fn()} />);
    await screen.findByLabelText('Graph');
    expect(screen.getByLabelText('输出文件夹')).toHaveValue('');
    for (const format of formats) expect(screen.getByLabelText(format.label)).toBeChecked();
    expect(screen.getByText('已选 2 栋，可转换 1 栋；跳过 1 栋未完成项目。')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('输出文件夹'), { target: { value: queued.outputRoot } });
    fireEvent.click(screen.getByText('开始转换'));
    await waitFor(() => expect(api.startConversion).toHaveBeenCalledWith({ projects: [{ buildingId: projects[0].building_id, revision: 4 }], formats: formats.map(format => format.id), outputRoot: queued.outputRoot, overwrite: false }));
    expect(localStorage.getItem(CONVERSION_PATH_KEY)).toBeNull();
    await screen.findByText('等待中');
    expect(JSON.parse(localStorage.getItem(CONVERSION_JOB_KEY)!)).toEqual({ id: 'job1', outputRoot: queued.outputRoot });
  });
  it('rejects relative paths and blocks an entirely incomplete selection', async () => {
    const { unmount } = render(<ConversionDialog projects={projects} onClose={vi.fn()} />);
    await screen.findByLabelText('Graph');
    fireEvent.change(screen.getByLabelText('输出文件夹'), { target: { value: 'output' } });
    fireEvent.click(screen.getByText('开始转换'));
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入服务器本机的绝对输出路径');
    expect(api.startConversion).not.toHaveBeenCalled();
    unmount();
    render(<ConversionDialog projects={[projects[1]]} onClose={vi.fn()} />);
    await screen.findByLabelText('Graph');
    expect(screen.getByText('开始转换')).toBeDisabled();
  });
  it('polls partial results, displays reasons and remembers a successful path', async () => {
    const finished: api.ConversionJob = { ...queued, status: 'completed', items: [
      { buildingId: projects[0].building_id, format: 'graph', status: 'succeeded' },
      { buildingId: projects[0].building_id, format: 'image', status: 'skipped', message: '目录已存在' },
      { buildingId: projects[0].building_id, format: 'cad', status: 'failed', message: 'DXF 验证失败' },
      { buildingId: projects[0].building_id, format: 'embodied', status: 'quarantined', message: '严格几何校验不通过' },
    ] };
    vi.mocked(api.getConversion).mockResolvedValue(finished);
    render(<ConversionDialog projects={projects} onClose={vi.fn()} />);
    await screen.findByLabelText('Graph');
    fireEvent.change(screen.getByLabelText('输出文件夹'), { target: { value: queued.outputRoot } });
    fireEvent.click(screen.getByText('开始转换'));
    await waitFor(() => expect(screen.getByText('失败：DXF 验证失败')).toBeTruthy(), { timeout: 2500 });
    expect(screen.getByText('已隔离：严格几何校验不通过')).toBeTruthy();
    expect(screen.getByText('已跳过：目录已存在')).toBeTruthy();
    expect(localStorage.getItem(CONVERSION_PATH_KEY)).toBe(queued.outputRoot);
    fireEvent.click(screen.getByText('打开输出目录'));
    await waitFor(() => expect(api.openConversionFolder).toHaveBeenCalledWith('job1'));
    fireEvent.click(screen.getByText('关闭'));
    expect(localStorage.getItem(CONVERSION_JOB_KEY)).toBeNull();
  });
  it('recovers a saved interrupted job after a server restart', async () => {
    const saved = { id: queued.id, outputRoot: queued.outputRoot };
    localStorage.setItem(CONVERSION_JOB_KEY, JSON.stringify(saved));
    vi.mocked(api.getConversion).mockRejectedValue(new ApiError('not found', 404, 'NOT_FOUND'));
    vi.mocked(api.recoverConversion).mockResolvedValue({ ...queued, status: 'interrupted', items: [{ ...queued.items[0], status: 'failed', message: '服务已重启' }] });
    render(<ConversionDialog projects={projects} onClose={vi.fn()} />);
    expect(await screen.findByText(/任务已中断，可重新提交/)).toBeTruthy();
    expect(api.recoverConversion).toHaveBeenCalledWith(saved);
    expect(localStorage.getItem(CONVERSION_PATH_KEY)).toBeNull();
  });
  it('retries a temporary progress failure without losing the active job', async () => {
    localStorage.setItem(CONVERSION_JOB_KEY, JSON.stringify({ id: queued.id, outputRoot: queued.outputRoot }));
    vi.mocked(api.getConversion).mockResolvedValueOnce(queued).mockRejectedValueOnce(new Error('网络暂时不可用')).mockResolvedValue({ ...queued, status: 'completed', items: [{ ...queued.items[0], status: 'succeeded' }] });
    render(<ConversionDialog projects={projects} onClose={vi.fn()} />);
    await screen.findByText('等待中');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('网络暂时不可用'), { timeout: 2500 });
    await waitFor(() => expect(screen.getByText('成功')).toBeTruthy(), { timeout: 2500 });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.getConversion).toHaveBeenCalledTimes(3);
  });
  it('allows format selection and overwrite and displays submission errors', async () => {
    localStorage.setItem(CONVERSION_PATH_KEY, queued.outputRoot);
    vi.mocked(api.startConversion).mockRejectedValue(new Error('项目版本已变化'));
    render(<ConversionDialog projects={projects} onClose={vi.fn()} />);
    await screen.findByLabelText('Graph');
    fireEvent.click(screen.getByLabelText('Image')); fireEvent.click(screen.getByLabelText('CAD')); fireEvent.click(screen.getByLabelText('Embodied'));
    fireEvent.click(screen.getByLabelText('覆盖已有结果')); fireEvent.click(screen.getByText('开始转换'));
    expect(await screen.findByRole('alert')).toHaveTextContent('项目版本已变化');
    expect(api.startConversion).toHaveBeenCalledWith(expect.objectContaining({ formats: ['graph'], overwrite: true }));
  });
  it('disables unavailable converters with the configuration reason', async () => {
    vi.mocked(api.listConversionFormats).mockResolvedValue({ formats: formats.map(format => ({ ...format, available: false, reason: '请安装 Python 环境' })) });
    render(<ConversionDialog projects={projects} onClose={vi.fn()} />);
    expect(await screen.findByLabelText('Graph（不可用：请安装 Python 环境）')).toBeDisabled();
    expect(screen.getByText('开始转换')).toBeDisabled();
  });
});
