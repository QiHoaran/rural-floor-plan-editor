// @vitest-environment node

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveBuildingDir,
  resolvePackageFile,
  validateBuildingId,
} from '../../server/pathSafety.ts';

describe('validateBuildingId', () => {
  it('accepts safe rural building identifiers', () => {
    expect(validateBuildingId('house_0001')).toBe('house_0001');
    expect(validateBuildingId('village-2_house-9')).toBe('village-2_house-9');
    expect(validateBuildingId(' A1 ')).toBe('A1');
  });

  it.each([
    '',
    '../escape',
    'a/b',
    'a\\b',
    '_house',
    'house_',
    `a${'b'.repeat(80)}`,
  ])('rejects unsafe identifier %j', (buildingId) => {
    expect(() => validateBuildingId(buildingId)).toThrow('建筑 ID');
  });
});

describe('resolveBuildingDir', () => {
  it('resolves a building below the configured data root', () => {
    const dataRoot = path.resolve('D:/app/data');
    const resolved = resolveBuildingDir(dataRoot, 'house_0001');

    expect(resolved).toBe(path.resolve(dataRoot, 'house_0001'));
    expect(resolved.startsWith(`${dataRoot}${path.sep}`)).toBe(true);
  });

  it('never resolves traversal input', () => {
    expect(() => resolveBuildingDir('D:/app/data', '../escape')).toThrow(
      '建筑 ID',
    );
  });
});

describe('resolvePackageFile', () => {
  it('resolves package-relative files below the building directory', () => {
    const dataRoot = path.resolve('D:/app/data');
    expect(
      resolvePackageFile(
        dataRoot,
        'house_0001',
        'reference/original.png',
      ),
    ).toBe(
      path.resolve(
        dataRoot,
        'house_0001',
        'reference',
        'original.png',
      ),
    );
  });

  it.each(['../secret.txt', '/absolute.txt', 'reference/../../secret.txt'])(
    'rejects unsafe package path %j',
    (relativePath) => {
      expect(() =>
        resolvePackageFile('D:/app/data', 'house_0001', relativePath),
      ).toThrow('文件路径');
    },
  );
});
