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

const VERTEX_RADIUS_PX = 6;
const HIT_RADIUS_PX = 14;

export function VertexLayer({
  document,
  pixelsPerMm,
  selectedVertexId,
  onSelectVertex,
  onStartDrag,
  selectable = true,
  shouldConsumePointerDown = (event) => event.button === 0,
}: VertexLayerProps) {
  const radius = VERTEX_RADIUS_PX / pixelsPerMm;
  const hitRadius = HIT_RADIUS_PX / pixelsPerMm;
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
            {/* Visual circle */}
            <circle
              data-testid={`vertex-visual-${vertexId}`}
              cx={vertex.x_mm}
              cy={vertex.y_mm}
              r={radius}
              fill={selected ? '#2563eb' : '#f59e0b'}
              stroke={selected ? '#1d4ed8' : '#d97706'}
              strokeWidth={selected ? 2 / pixelsPerMm : 1 / pixelsPerMm}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </g>
        );
      })}
    </g>
  );
}
