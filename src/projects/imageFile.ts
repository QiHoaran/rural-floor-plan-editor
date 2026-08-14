import {
  uploadReferenceImage,
  type ReferenceImageUploadInput,
} from '@/api/projectApi.ts';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';

export type ImageFileData = ReferenceImageUploadInput;

const SUPPORTED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function readImageFile(file: File): Promise<ImageFileData> {
  if (!SUPPORTED_MIMES.has(file.type)) {
    throw new Error('参考草图只支持 JPEG、PNG 或 WebP');
  }
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error('参考草图不能为空且不能超过 10 MB');
  }

  const [image_base64, dimensions] = await Promise.all([
    readBase64(file),
    readDimensions(file),
  ]);
  return {
    image_name: file.name,
    image_mime: file.type as ImageFileData['image_mime'],
    image_base64,
    width_px: dimensions.width,
    height_px: dimensions.height,
  };
}

export async function uploadReferenceImageFile(
  buildingId: string,
  file: File,
): Promise<BuildingDocument> {
  return uploadReferenceImage(buildingId, await readImageFile(file));
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const separator = result.indexOf(',');
      if (separator < 0) {
        reject(new Error('无法读取参考草图'));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.onerror = () => reject(new Error('无法读取参考草图'));
    reader.readAsDataURL(file);
  });
}

function readDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法解析参考草图尺寸'));
    };
    image.src = url;
  });
}
