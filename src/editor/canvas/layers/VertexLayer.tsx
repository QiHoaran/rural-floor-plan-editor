import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface VertexLayerProps {
  visibleVertexIds?: ReadonlySet<string>;
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
    event: ReactPointerEvent<SVGRectElement>,
  ) => boolean;
}

// Keep vertices visible and easy to select when zoomed out.
const MIN_SCREEN_SIDE_PX = 16;
const HIT_PADDING_PX = 8;

export function VertexLayer({
  visibleVertexIds,
  document,
  pixelsPerMm,
  selectedVertexId,
  onSelectVertex,
  onStartDrag,
  selectable = true,
  shouldConsumePointerDown = (event) => event.button === 0,
}: VertexLayerProps) {
  const thicknessByVertex = new Map<string, number>();
  for (const wall of Object.values(document.walls)) {
    for (const vertexId of [wall.start_vertex_id, wall.end_vertex_id]) {
      thicknessByVertex.set(
        vertexId,
        Math.max(thicknessByVertex.get(vertexId) ?? 0, wall.thickness_mm),
      );
    }
  }
  return (
    <g aria-label="顶点图层">
      {Object.entries(document.vertices).map(([vertexId, vertex]) => {
        if (visibleVertexIds && !visibleVertexIds.has(vertexId)) return null;
        const selected = vertexId === selectedVertexId;
        const connected = thicknessByVertex.has(vertexId);
        const thicknessMm = thicknessByVertex.get(vertexId)
          ?? document.building_defaults.wall_thickness_mm;
        const side = Math.max(thicknessMm, MIN_SCREEN_SIDE_PX / pixelsPerMm);
        const hitSide = side + 2 * HIT_PADDING_PX / pixelsPerMm;
        return (
          <g key={vertexId}>
            {/* Larger invisible square for easy pointer capture */}
            <rect
              data-testid={`vertex-hit-${vertexId}`}
              x={vertex.x_mm - hitSide / 2}
              y={vertex.y_mm - hitSide / 2}
              width={hitSide}
              height={hitSide}
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
            {/* Visual square — strokeWidth 已除以 pixelsPerMm，与 transform 抵消后保持恒定屏幕像素 */}
            <rect
              data-testid={`vertex-visual-${vertexId}`}
              x={vertex.x_mm - side / 2}
              y={vertex.y_mm - side / 2}
              width={side}
              height={side}
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
