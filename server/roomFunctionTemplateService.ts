import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CORE_ROOM_FUNCTION_PRESETS, normalizeFunctionName, roomFunctionCatalog, type RoomFunctionTemplate } from '../src/editor/domain/roomFunctionTemplates.js';
import { atomicWriteJson } from './atomicWrite.js';
import { ServiceError } from './errors.js';

const SETTINGS_DIRECTORY = '.settings';
const TEMPLATE_FILE = 'room-function-templates.json';
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export class RoomFunctionTemplateService {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly dataRoot: string) {}

  list(): Promise<RoomFunctionTemplate[]> {
    return this.read();
  }

  create(input: unknown): Promise<RoomFunctionTemplate> {
    return this.withLock(async () => {
      const value = validateTemplateInput(input);
      const templates = await this.read();
      const existing = roomFunctionCatalog(templates).find((item) => normalizeFunctionName(item.name) === normalizeFunctionName(value.name));
      if (existing) return existing;
      const created = {
        code: `custom_${randomUUID()}`,
        ...value,
      };
      await this.write([...templates, created]);
      return created;
    });
  }

  update(code: string, input: unknown): Promise<RoomFunctionTemplate> {
    return this.withLock(async () => {
      if (CORE_ROOM_FUNCTION_PRESETS.some((item) => item.code === code)) throw new ServiceError('系统内置功能不可修改', 409, 'ROOM_TEMPLATE_BUILT_IN');
      const value = validateTemplateInput(input);
      const templates = await this.read();
      const index = templates.findIndex((item) => item.code === code);
      if (index < 0) {
        throw new ServiceError('房间模板不存在', 404, 'ROOM_TEMPLATE_NOT_FOUND');
      }
      const existing = roomFunctionCatalog(templates).find((item) => item.code !== code && normalizeFunctionName(item.name) === normalizeFunctionName(value.name));
      if (existing) {
        await this.write(templates.filter((item) => item.code !== code));
        return existing;
      }
      const updated = { ...templates[index], code, ...value };
      const next = [...templates];
      next[index] = updated;
      await this.write(next);
      return updated;
    });
  }

  delete(code: string): Promise<void> {
    return this.withLock(async () => {
      const templates = await this.read();
      if (CORE_ROOM_FUNCTION_PRESETS.some((item) => item.code === code) || templates.find((item) => item.code === code)?.is_builtin) throw new ServiceError('内置功能不可删除，请先取消内置', 409, 'ROOM_TEMPLATE_BUILT_IN');
      if (!templates.some((item) => item.code === code)) {
        throw new ServiceError('房间模板不存在', 404, 'ROOM_TEMPLATE_NOT_FOUND');
      }
      await this.write(templates.filter((item) => item.code !== code));
    });
  }

  private async read(): Promise<RoomFunctionTemplate[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('templates must be an array');
      const entries = parsed.map((item) => {
        const value = item as RoomFunctionTemplate;
        if (
          typeof value.code !== 'string' ||
          !value.code.startsWith('custom_')
        ) {
          throw new Error('invalid template code');
        }
        return { code: value.code, ...validateTemplateInput(value) };
      });
      return roomFunctionCatalog(entries).filter((item) => !CORE_ROOM_FUNCTION_PRESETS.some((preset) => preset.code === item.code));
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw new ServiceError(
        '房间模板配置无法读取',
        500,
        'ROOM_TEMPLATE_CONFIG_INVALID',
      );
    }
  }

  private write(templates: RoomFunctionTemplate[]): Promise<void> {
    return atomicWriteJson(this.filePath, templates);
  }

  private get filePath(): string {
    return path.join(this.dataRoot, SETTINGS_DIRECTORY, TEMPLATE_FILE);
  }

  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}

function validateTemplateInput(input: unknown): { name: string; color: string; is_builtin?: boolean } {
  const value = input as { name?: unknown; color?: unknown; is_builtin?: unknown } | null;
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  const color = typeof value?.color === 'string' ? value.color.trim() : '';
  if (!name || name.length > 30) {
    throw new ServiceError(
      '模板名称不能为空且不能超过 30 个字符',
      400,
      'INVALID_ROOM_TEMPLATE_NAME',
    );
  }
  if (!COLOR_PATTERN.test(color)) {
    throw new ServiceError(
      '模板颜色必须是 #RRGGBB 格式',
      400,
      'INVALID_ROOM_TEMPLATE_COLOR',
    );
  }
  if (value?.is_builtin !== undefined && typeof value.is_builtin !== 'boolean') throw new ServiceError('内置标记必须为布尔值', 400, 'INVALID_ROOM_TEMPLATE_BUILT_IN');
  return { name, color: color.toLowerCase(), ...(value?.is_builtin !== undefined ? { is_builtin: value.is_builtin as boolean } : {}) };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

