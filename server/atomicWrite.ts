import fs from 'node:fs/promises';
import path from 'node:path';

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(directory, { recursive: true });

  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(temporaryPath, 'w');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
