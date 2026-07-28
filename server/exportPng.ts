import sharp from 'sharp';
import { ServiceError } from './errors.js';

const MAX_PIXEL_DIMENSION = 8000;

export async function renderPng(svgString: string): Promise<Buffer> {
  try {
    return await sharp(Buffer.from(svgString, 'utf-8'), {
      limitInputPixels: false,
    })
      .resize({
        width: MAX_PIXEL_DIMENSION,
        height: MAX_PIXEL_DIMENSION,
        fit: 'inside',
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
  } catch (error) {
    throw new ServiceError(
      `PNG 渲染失败：${error instanceof Error ? error.message : '未知错误'}`,
      500,
      'PNG_RENDER_FAILED',
    );
  }
}
