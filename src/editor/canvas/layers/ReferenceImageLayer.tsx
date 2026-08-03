import type { PointerEvent as ReactPointerEvent } from 'react';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import type { ReferenceImage } from '@/editor/domain/buildingTypes.ts';

export type ReferenceCorner = 'tl' | 'tr' | 'bl' | 'br';

interface ReferenceImageLayerProps {
  document: BuildingDocument;
  adjustable: boolean;
  pixelsPerMm: number;
  previewImage?: ReferenceImage | null;
  onStartScale?: (
    corner: ReferenceCorner,
    pointerId: number,
    event: ReactPointerEvent<SVGRectElement>,
  ) => void;
}

/** 缩放控制柄的屏幕像素尺寸 */
const HANDLE_SIZE_PX = 10;
/** 控制柄命中区域（屏幕像素） */
const HANDLE_HIT_PX = 24;

export function ReferenceImageLayer({
  document,
  adjustable,
  pixelsPerMm,
  previewImage,
  onStartScale,
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

  // 局部坐标以 scale 放大到世界坐标，再经 pixelsPerMm 放大到屏幕。
  // 因此恒定屏幕尺寸的控制柄在局部坐标中的大小为 px / (pixelsPerMm * scale)。
  const pixelsPerLocalUnit = pixelsPerMm * transform.scale;
  const handleSize = HANDLE_SIZE_PX / pixelsPerLocalUnit;
  const hitSize = HANDLE_HIT_PX / pixelsPerLocalUnit;

  const corners: Array<{
    corner: ReferenceCorner;
    x: number;
    y: number;
    cursor: string;
  }> = [
    { corner: 'tl', x: 0, y: 0, cursor: 'nwse-resize' },
    { corner: 'tr', x: width, y: 0, cursor: 'nesw-resize' },
    { corner: 'bl', x: 0, y: height, cursor: 'nesw-resize' },
    { corner: 'br', x: width, y: height, cursor: 'nwse-resize' },
  ];

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
      {adjustable &&
        corners.map(({ corner, x, y, cursor }) => (
          <g key={corner}>
            {/* 命中区域 — 透明大矩形，便于抓取 */}
            <rect
              data-testid={`reference-scale-handle-hit-${corner}`}
              x={x - hitSize / 2}
              y={y - hitSize / 2}
              width={hitSize}
              height={hitSize}
              fill="transparent"
              stroke="none"
              style={{ cursor }}
              role="button"
              aria-label={`缩放参考图 ${corner}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onStartScale?.(corner, event.pointerId, event);
              }}
            />
            {/* 可视方块 — 不接收指针事件，避免干扰命中区域 */}
            <rect
              data-testid={`reference-scale-handle-${corner}`}
              x={x - handleSize / 2}
              y={y - handleSize / 2}
              width={handleSize}
              height={handleSize}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth={1 / pixelsPerMm / transform.scale}
              pointerEvents="none"
            />
          </g>
        ))}
    </g>
  );
}
