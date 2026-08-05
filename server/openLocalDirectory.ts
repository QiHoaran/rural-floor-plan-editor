import { spawn } from 'node:child_process';
import { ServiceError } from './errors.js';

export async function openLocalDirectory(directory: string): Promise<void> {
  const command = platformCommand(process.platform, directory);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', (error) => reject(error));
  }).catch((error) => {
    throw new ServiceError(
      `无法打开本地文件夹：${error instanceof Error ? error.message : '未知错误'}`,
      500,
      'OPEN_FOLDER_FAILED',
    );
  });
}

export function platformCommand(
  platform: NodeJS.Platform,
  directory: string,
): { executable: string; args: string[] } {
  if (platform === 'win32') return { executable: 'explorer.exe', args: [directory] };
  if (platform === 'darwin') return { executable: 'open', args: [directory] };
  if (platform === 'linux') return { executable: 'xdg-open', args: [directory] };
  throw new ServiceError(
    `当前系统 ${platform} 不支持打开文件夹`,
    501,
    'OPEN_FOLDER_UNSUPPORTED',
  );
}

