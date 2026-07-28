import path from 'node:path';
import { ServiceError } from './errors.js';

const BUILDING_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/;
const MAX_BUILDING_ID_LENGTH = 80;

export function validateBuildingId(value: string): string {
  const buildingId = value.trim();
  if (
    buildingId.length === 0 ||
    buildingId.length > MAX_BUILDING_ID_LENGTH ||
    !BUILDING_ID_PATTERN.test(buildingId)
  ) {
    throw new ServiceError(
      '建筑 ID 只能包含字母、数字、下划线和短横线，且必须以字母或数字开头、结尾',
      400,
      'INVALID_BUILDING_ID',
    );
  }
  return buildingId;
}

export function resolveBuildingDir(
  dataRoot: string,
  buildingId: string,
): string {
  const safeId = validateBuildingId(buildingId);
  const root = path.resolve(dataRoot);
  const resolved = path.resolve(root, safeId);
  const relative = path.relative(root, resolved);

  if (
    relative.length === 0 ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new ServiceError(
      '建筑 ID 解析到了 data 目录之外',
      400,
      'INVALID_BUILDING_ID',
    );
  }

  return resolved;
}

export function resolvePackageFile(
  dataRoot: string,
  buildingId: string,
  relativePath: string,
): string {
  const buildingDir = resolveBuildingDir(dataRoot, buildingId);
  if (
    !relativePath ||
    relativePath.includes('\0') ||
    path.isAbsolute(relativePath)
  ) {
    throw new ServiceError(
      '建筑包文件路径无效',
      400,
      'INVALID_PACKAGE_PATH',
    );
  }

  const resolved = path.resolve(buildingDir, relativePath);
  const relative = path.relative(buildingDir, resolved);
  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new ServiceError(
      '建筑包文件路径超出了建筑目录',
      400,
      'INVALID_PACKAGE_PATH',
    );
  }
  return resolved;
}
