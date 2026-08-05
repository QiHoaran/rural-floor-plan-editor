import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CustomFunctionType } from '../src/editor/domain/buildingTypes.js';
import { atomicWriteJson } from './atomicWrite.js';
import { ServiceError } from './errors.js';

const SETTINGS_DIRECTORY = '.settings';
const TEMPLATE_FILE = 'room-function-templates.json';
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export class RoomFunctionTemplateService {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly dataRoot: string) {}

  list(): Promise<CustomFunctionType[]> {
    return this.read();
  }

  create(input: unknown): Promise<CustomFunctionType> {
    return this.withLock(async () => {
      const value = validateTemplateInput(input);
      const templates = await this.read();
      assertUniqueName(templates, value.name);
      const created = {
        code: `custom_${randomUUID()}`,
        ...value,
      };
      await this.write([...templates, created]);
      return created;
    });
  }

  update(code: string, input: unknown): Promise<CustomFunctionType> {
    return this.withLock(async () => {
      const value = validateTemplateInput(input);
      const templates = await this.read();
      const index = templates.findIndex((item) => item.code === code);
      if (index < 0) {
        throw new ServiceError('房间模板不存在', 404, 'ROOM_TEMPLATE_NOT_FOUND');
      }
      assertUniqueName(templates, value.name, code);
      const updated = { code, ...value };
      const next = [...templates];
      next[index] = updated;
      await this.write(next);
      return updated;
    });
  }

  delete(code: string): Promise<void> {
    return this.withLock(async () => {
      const templates = await this.read();
      if (!templates.some((item) => item.code === code)) {
        throw new ServiceError('房间模板不存在', 404, 'ROOM_TEMPLATE_NOT_FOUND');
      }
      await this.write(templates.filter((item) => item.code !== code));
    });
  }

  private async read(): Promise<CustomFunctionType[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('templates must be an array');
      return parsed.map((item) => {
        const value = item as CustomFunctionType;
        if (
          typeof value.code !== 'string' ||
          !value.code.startsWith('custom_')
        ) {
          throw new Error('invalid template code');
        }
        return { code: value.code, ...validateTemplateInput(value) };
      });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw new ServiceError(
        '房间模板配置无法读取',
        500,
        'ROOM_TEMPLATE_CONFIG_INVALID',
      );
    }
  }

  private write(templates: CustomFunctionType[]): Promise<void> {
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

function validateTemplateInput(input: unknown): { name: string; color: string } {
  const value = input as { name?: unknown; color?: unknown } | null;
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
  return { name, color: color.toLowerCase() };
}

function assertUniqueName(
  templates: CustomFunctionType[],
  name: string,
  exceptCode?: string,
): void {
  if (
    templates.some(
      (item) => item.code !== exceptCode && item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    throw new ServiceError('模板名称已存在', 409, 'ROOM_TEMPLATE_NAME_EXISTS');
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

