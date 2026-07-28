import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import type { ReferenceImage } from '@/editor/domain/buildingTypes.ts';

interface ReferenceImageLayerProps {
  document: BuildingDocument;
  adjustable: boolean;
  pixelsPerMm: number;
  previewImage?: ReferenceImage | null;
}

export function ReferenceImageLayer({
  document,
  adjustable,
  pixelsPerMm,
  previewImage,
}: ReferenceImageLayerProps) {
  const image = previewImage ?? document.reference_image;
  const width = Math.max(1, image.width_px);
  const height = Math.max(1, image.height_px);
  const transform = image.transform;
  const href = `/api/projects/${encodeURIComponent(
    document.building_id,
  )}/files/${image.path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;

  return (
    <g
      transform={`translate(${transform.translate_x_mm} ${transform.translate_y_mm}) rotate(${transform.rotation_deg}) scale(${transform.scale})`}
      opacity={image.opacity}
      pointerEvents={adjustable ? 'visiblePainted' : 'none'}
    >
      <image
        data-testid="reference-image"
        href={href}
        x={0}
        y={0}
        width={width}
        height={height}
        transform={`translate(0 ${height}) scale(1 -1)`}
        preserveAspectRatio="none"
      />
      {adjustable && (
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="none"
          stroke="#2563eb"
          strokeWidth={2 / pixelsPerMm / transform.scale}
          strokeDasharray={`${8 / pixelsPerMm / transform.scale} ${5 / pixelsPerMm / transform.scale}`}
        />
      )}
    </g>
  );
}
