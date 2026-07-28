import type {
  BuildingDocument,
  BuildingVertex,
} from '@/editor/domain/buildingTypes.ts';

interface WallLayerProps {
  document: BuildingDocument;
  pixelsPerMm: number;
  selectedWallId: string | null;
  onSelectWall: (wallId: string) => void;
  selectable?: boolean;
}

export function WallLayer({
  document,
  pixelsPerMm,
  selectedWallId,
  onSelectWall,
  selectable = true,
}: WallLayerProps) {
  return (
    <g aria-label="墙体图层">
      {Object.entries(document.walls).map(([wallId, wall]) => {
        const start = document.vertices[wall.start_vertex_id];
        const end = document.vertices[wall.end_vertex_id];
        if (!start || !end) return null;
        const polygon = wallPolygon(start, end, wall.thickness_mm);
        const selected = wallId === selectedWallId;
        return (
          <g key={wallId}>
            <polygon
              data-testid={`wall-polygon-${wallId}`}
              points={polygon.map((point) => `${point.x_mm},${point.y_mm}`).join(' ')}
              fill={wall.wall_type === 'exterior' ? '#334155' : '#64748b'}
              stroke={selected ? '#2563eb' : 'none'}
              strokeWidth={selected ? 3 : 0}
              vectorEffect="non-scaling-stroke"
            />
            <line
              data-testid={`wall-hit-${wallId}`}
              x1={start.x_mm}
              y1={start.y_mm}
              x2={end.x_mm}
              y2={end.y_mm}
              stroke="transparent"
              strokeWidth={12 / pixelsPerMm}
              onPointerDown={(event) => {
                if (!selectable) return;
                event.stopPropagation();
                onSelectWall(wallId);
              }}
            />
          </g>
        );
      })}
    </g>
  );
}

function wallPolygon(
  start: BuildingVertex,
  end: BuildingVertex,
  thicknessMm: number,
): BuildingVertex[] {
  const dx = end.x_mm - start.x_mm;
  const dy = end.y_mm - start.y_mm;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [start, end];
  const offsetX = (-dy / length) * (thicknessMm / 2);
  const offsetY = (dx / length) * (thicknessMm / 2);
  return [
    { x_mm: start.x_mm + offsetX, y_mm: start.y_mm + offsetY },
    { x_mm: end.x_mm + offsetX, y_mm: end.y_mm + offsetY },
    { x_mm: end.x_mm - offsetX, y_mm: end.y_mm - offsetY },
    { x_mm: start.x_mm - offsetX, y_mm: start.y_mm - offsetY },
  ];
}
