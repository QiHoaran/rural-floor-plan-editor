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
 * - 放大画布时：直径始终等于墙体宽度（radius = wallThicknessMm / 2），
 *   顶点刚好填满墙体接头，与墙体宽度保持一致
 * - 缩小画布时：半径不小于最小屏幕像素半径，点稍微变大、仍清晰可见
 */

/** 顶点在屏幕上的最小半径（px），保证缩小画布时仍可点选 */
const MIN_SCREEN_RADIUS_PX = 8;
/** 命中区域额外扩展（px），在视觉半径基础上增加 */
const HIT_PADDING_PX = 8;

/**
 * 基于墙体宽度的自适应顶点半径。
 * 放大时直径等于墙体宽度，缩小时保持最小屏幕像素尺寸。
 */
function adaptiveRadius(
  wallThicknessMm: number,
  pixelsPerMm: number,
  minScreenPx: number,
): number {
  // 基准：半径 = 墙体半宽（直径 = 墙体全宽）
  const baseRadiusMm = wallThicknessMm / 2;
  // 缩小时提升到最小屏幕半径，放大时保持基准尺寸不变
  return Math.max(baseRadiusMm, minScreenPx / pixelsPerMm);
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
  );
  // 命中区域 = 视觉半径 + 固定屏幕像素扩展，保证点选手感
  const hitRadius = radius + HIT_PADDING_PX / pixelsPerMm;
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
