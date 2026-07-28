import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface VertexLayerProps {
  document: BuildingDocument;
  pixelsPerMm: number;
  selectedVertexId: string | null;
  onSelectVertex: (vertexId: string) => void;
  onStartDrag: (
    vertexId: string,
    pointerId: number,
  ) => void;
  selectable?: boolean;
  shouldConsumePointerDown?: (
    event: ReactPointerEvent<SVGCircleElement>,
  ) => boolean;
}

/**
 * 顶点大小计算策略：
 * - 基准：顶点直径 = 墙体宽度（radius = wallThicknessMm / 2），
 *   使得顶点在正常缩放级别下刚好填满墙体接头
 * - 缩小时放大：当画布缩小时，保证最小屏幕像素尺寸，方便点选
 * - 放大时缩小：当画布放大时，限制最大屏幕像素尺寸，避免遮挡几何
 */

/** 顶点在屏幕上的最小半径（px），保证缩小画布时仍可点选 */
const MIN_SCREEN_RADIUS_PX = 8;
/** 顶点在屏幕上的最大半径（px），避免放大画布时遮挡过多 */
const MAX_SCREEN_RADIUS_PX = 22;
/** 命中区域额外扩展（px），在视觉半径基础上增加 */
const HIT_PADDING_PX = 8;

/**
 * 基于墙体宽度的自适应顶点半径。
 * 基准直径为墙体宽度，屏幕像素尺寸约束在 [minScreenPx, maxScreenPx] 范围内。
 */
function adaptiveRadius(
  wallThicknessMm: number,
  pixelsPerMm: number,
  minScreenPx: number,
  maxScreenPx: number,
): number {
  // 基准：半径 = 墙体半宽（直径 = 墙体全宽）
  const baseRadiusMm = wallThicknessMm / 2;
  // 基准屏幕像素尺寸
  const rawScreenPx = baseRadiusMm * pixelsPerMm;
  // 钳制屏幕像素
  const clampedScreenPx = Math.max(
    minScreenPx,
    Math.min(maxScreenPx, rawScreenPx),
  );
  // 转回世界坐标 mm
  return clampedScreenPx / pixelsPerMm;
}

export function VertexLayer({
  document,
  pixelsPerMm,
  selectedVertexId,
  onSelectVertex,
  onStartDrag,
  selectable = true,
  shouldConsumePointerDown = (event) => event.button === 0,
}: VertexLayerProps) {
  const wallThicknessMm = document.building_defaults.wall_thickness_mm;

  const radius = adaptiveRadius(
    wallThicknessMm,
    pixelsPerMm,
    MIN_SCREEN_RADIUS_PX,
    MAX_SCREEN_RADIUS_PX,
  );
  const hitRadius = adaptiveRadius(
    wallThicknessMm,
    pixelsPerMm,
    MIN_SCREEN_RADIUS_PX + HIT_PADDING_PX,
    MAX_SCREEN_RADIUS_PX + HIT_PADDING_PX,
  );
  return (
    <g aria-label="顶点图层">
      {Object.entries(document.vertices).map(([vertexId, vertex]) => {
        const selected = vertexId === selectedVertexId;
        const connected = Object.values(document.walls).some(
          (wall) =>
            wall.start_vertex_id === vertexId ||
            wall.end_vertex_id === vertexId,
        );
        return (
          <g key={vertexId}>
            {/* Hit target — larger invisible circle for easy pointer capture */}
            <circle
              data-testid={`vertex-hit-${vertexId}`}
              cx={vertex.x_mm}
              cy={vertex.y_mm}
              r={hitRadius}
              fill="transparent"
              stroke="none"
              role={selectable ? 'button' : undefined}
              aria-label={connected ? `顶点 ${vertexId}` : `孤立顶点 ${vertexId}`}
              aria-pressed={selected}
              tabIndex={selectable ? 0 : -1}
              onPointerDown={(event) => {
                if (!selectable || !shouldConsumePointerDown(event)) return;
                event.stopPropagation();
                event.preventDefault();
                onSelectVertex(vertexId);
                onStartDrag(vertexId, event.pointerId);
              }}
              onKeyDown={(event) => {
                if (
                  !selectable ||
                  (event.key !== 'Enter' && event.key !== ' ')
                ) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                onSelectVertex(vertexId);
              }}
            />
            {/* Visual circle — strokeWidth 已除以 pixelsPerMm，与 transform 抵消后保持恒定屏幕像素 */}
            <circle
              data-testid={`vertex-visual-${vertexId}`}
              cx={vertex.x_mm}
              cy={vertex.y_mm}
              r={radius}
              fill={selected ? '#2563eb' : '#f59e0b'}
              stroke={selected ? '#1d4ed8' : '#d97706'}
              strokeWidth={selected ? 2 / pixelsPerMm : 1 / pixelsPerMm}
              pointerEvents="none"
            />
          </g>
        );
      })}
    </g>
  );
}
