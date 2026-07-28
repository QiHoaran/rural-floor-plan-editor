import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import { polygonMetrics } from '@/editor/topology/polygonGeometry.ts';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface FaceLayerProps {
  document: BuildingDocument;
  selectedFaceId: string | null;
  onSelectFace: (faceId: string) => void;
  selectable?: boolean;
  pixelsPerMm?: number;
  shouldConsumePointerDown?: (
    event: ReactPointerEvent<SVGPolygonElement>,
  ) => boolean;
}

const DEFAULT_FACE_FILL = '#94a3b8';

function safeColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_FACE_FILL;
}

export function FaceLayer({
  document,
  selectedFaceId,
  onSelectFace,
  selectable = true,
  pixelsPerMm = 1,
  shouldConsumePointerDown = (event) => event.button === 0,
}: FaceLayerProps) {
  return (
    <g aria-label="功能面图层">
      {Object.entries(document.faces).map(([faceId, face]) => {
        const points = face.boundary_vertex_ids.map(
          (vertexId) => document.vertices[vertexId],
        );
        if (points.length < 3 || points.some((point) => !point)) return null;
        const metrics = polygonMetrics(points);
        if (!metrics) return null;
        const selected = selectedFaceId === faceId;
        return (
          <g key={faceId}>
            <polygon
              data-testid={`face-polygon-${faceId}`}
              points={points
                .map((point) => `${point.x_mm},${point.y_mm}`)
                .join(' ')}
              fill={safeColor(face.color)}
              fillOpacity={0.32}
              stroke={selected ? '#2563eb' : 'transparent'}
              strokeWidth={selected ? 3 : 0}
              vectorEffect="non-scaling-stroke"
              pointerEvents={selectable ? 'all' : 'none'}
              role={selectable ? 'button' : undefined}
              aria-label={face.display_name || face.local_name || faceId}
              aria-pressed={selected}
              tabIndex={selectable ? 0 : -1}
              onPointerDown={(event) => {
                if (!selectable || !shouldConsumePointerDown(event)) return;
                event.stopPropagation();
                onSelectFace(faceId);
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
                onSelectFace(faceId);
              }}
            />
            {face.display_name && (
              <text
                x={metrics.centroid.x_mm}
                y={-metrics.centroid.y_mm}
                transform="scale(1 -1)"
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={13 / pixelsPerMm}
                fill="#334155"
                pointerEvents="none"
              >
                {face.display_name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
