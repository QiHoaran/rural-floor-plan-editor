import { describe, expect, it } from 'vitest';
import { readImageFile } from '../../src/projects/imageFile.ts';

describe('reference image file validation', () => {
  it('rejects unsupported image types before reading them', async () => {
    await expect(
      readImageFile(new File(['gif'], 'plan.gif', { type: 'image/gif' })),
    ).rejects.toThrow('只支持 JPEG、PNG 或 WebP');
  });

  it('rejects empty and oversized image files', async () => {
    await expect(
      readImageFile(new File([], 'empty.png', { type: 'image/png' })),
    ).rejects.toThrow('不能为空且不能超过 10 MB');
    await expect(
      readImageFile(new File(
        [new Uint8Array(10 * 1024 * 1024 + 1)],
        'large.png',
        { type: 'image/png' },
      )),
    ).rejects.toThrow('不能为空且不能超过 10 MB');
  });
});
