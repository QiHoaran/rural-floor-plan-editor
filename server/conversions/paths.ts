import fs from 'node:fs/promises';
import path from 'node:path';
import { ServiceError } from '../errors.js';

export function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function unsafe(): never { throw new ServiceError('输出必须位于指定绝对目录内，不能写入 data 或经过子目录链接', 400, 'UNSAFE_OUTPUT_PATH'); }
/** Resolve an existing ancestor too, so aliases are rejected before mkdir. */
export async function realFuture(candidate: string): Promise<string> {
  try { return await fs.realpath(candidate); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // A dangling link must not be treated as an ordinary missing directory.
    try { if ((await fs.lstat(candidate)).isSymbolicLink()) unsafe(); }
    catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError; }
    const parent = path.dirname(candidate);
    if (parent === candidate) throw error;
    return path.join(await realFuture(parent), path.basename(candidate));
  }
}
export class OutputPaths {
  constructor(private readonly forbidden: string[]) {}
  async root(value: string, create = false): Promise<string> {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) unsafe();
    const resolved = await realFuture(path.resolve(value));
    for (const root of this.forbidden) if (within(await realFuture(path.resolve(root)), resolved)) unsafe();
    if (create) await fs.mkdir(resolved, {recursive:true});
    return resolved;
  }
  async child(root: string, ...segments: string[]): Promise<string> {
    const candidate = path.resolve(root, ...segments);
    if (candidate === root || !within(root, candidate)) unsafe();
    const canonicalRoot = await this.root(root);
    if (path.relative(canonicalRoot, root) !== '') unsafe();
    // Forbid descendant symlinks/junctions even when they happen to point inside.
    let walk = root;
    for (const segment of path.relative(root,candidate).split(path.sep)) {
      walk = path.join(walk,segment);
      try { if ((await fs.lstat(walk)).isSymbolicLink()) unsafe(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const resolved = await this.root(candidate);
    if (!within(root,resolved) || path.relative(candidate,resolved) !== '') unsafe();
    return candidate;
  }
  async remove(root: string, candidate: string): Promise<void> {
    await this.child(root, path.relative(root,candidate));
    await fs.rm(candidate, {recursive:true,force:true});
  }
}
