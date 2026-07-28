import type { BuildingDocument, WallElementType } from '@/editor/domain/buildingTypes.ts';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface Props {
  document: BuildingDocument;
  pixelsPerMm: number;
  selectedElementId: string | null;
  onSelectElement: (elementId: string) => void;
  selectable?: boolean;
  shouldConsumePointerDown?: (
    event: ReactPointerEvent<SVGLineElement>,
  ) => boolean;
}

const LABELS: Record<WallElementType, string> = {
  exterior_door: 'Exterior door',
  exterior_window: 'Exterior window',
  interior_door: 'Interior door',
  passage: 'Passage',
};

export function WallElementLayer({
  document,
  pixelsPerMm: _pixelsPerMm,
  selectedElementId,
  onSelectElement,
  selectable = true,
  shouldConsumePointerDown = (event) => event.button === 0,
}: Props) {
  return <g aria-label="Wall elements">
    {Object.entries(document.wall_elements).map(([id, element]) => {
      const wall = document.walls[element.host_wall_id];
      const start = wall && document.vertices[wall.start_vertex_id];
      const end = wall && document.vertices[wall.end_vertex_id];
      if (!wall || !start || !end) return null;
      const length = Math.hypot(end.x_mm - start.x_mm, end.y_mm - start.y_mm);
      if (!Number.isFinite(length) || length === 0) return null;
      const ux = (end.x_mm - start.x_mm) / length;
      const uy = (end.y_mm - start.y_mm) / length;
      const nx = -uy;
      const ny = ux;
      const x1 = start.x_mm + ux * element.offset_from_start_mm;
      const y1 = start.y_mm + uy * element.offset_from_start_mm;
      const x2 = x1 + ux * element.width_mm;
      const y2 = y1 + uy * element.width_mm;
      const activate = () => selectable && onSelectElement(id);
      const color =
        element.element_type === 'exterior_door'
          ? '#f97316'
          : element.element_type === 'interior_door'
            ? '#2563eb'
            : element.element_type === 'exterior_window'
              ? '#0891b2'
              : '#9333ea';
      const dash =
        element.element_type === 'interior_door'
          ? '6 3.5'
          : element.element_type === 'passage'
            ? '8 4.5'
            : undefined;
      return <g
        key={id}
        role={selectable ? 'button' : undefined}
        tabIndex={selectable ? 0 : undefined}
        aria-label={`${LABELS[element.element_type]} ${id}`}
        data-testid={`wall-element-symbol-${id}`}
        data-element-type={element.element_type}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
          }
        }}
      >
        <line data-testid={`wall-element-primary-${id}`}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color} strokeDasharray={dash}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke" />
        {selectedElementId === id && <line
          x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0f172a"
          strokeWidth={6} strokeOpacity={0.25}
          vectorEffect="non-scaling-stroke" />}
        {element.element_type.includes('door') && <path
          data-testid={`wall-element-swing-${id}`}
          d={`M ${x1} ${y1} Q ${x1 + nx * element.width_mm * 0.7 + ux * element.width_mm * 0.3} ${y1 + ny * element.width_mm * 0.7 + uy * element.width_mm * 0.3} ${x1 + nx * element.width_mm} ${y1 + ny * element.width_mm}`}
          stroke={color} strokeDasharray={dash}
          fill="none" strokeWidth={2}
          vectorEffect="non-scaling-stroke" />}
        {element.element_type === 'exterior_door' && <line
          data-testid={`wall-element-exterior-marker-${id}`}
          x1={x1 + nx * 45} y1={y1 + ny * 45}
          x2={x2 + nx * 45} y2={y2 + ny * 45}
          stroke={color} strokeWidth={2}
          vectorEffect="non-scaling-stroke" />}
        {element.element_type === 'exterior_window' && <line
          data-testid={`wall-element-window-second-${id}`}
          x1={x1 + nx * 35} y1={y1 + ny * 35}
          x2={x2 + nx * 35} y2={y2 + ny * 35}
          stroke={color} strokeWidth={2}
          vectorEffect="non-scaling-stroke" />}
        {element.element_type === 'passage' && <path
          data-testid={`wall-element-passage-bracket-${id}`}
          d={`M ${x1 + nx * 90} ${y1 + ny * 90} L ${x1} ${y1} M ${x2} ${y2} L ${x2 + nx * 90} ${y2 + ny * 90}`}
          stroke={color} fill="none" strokeWidth={2}
          vectorEffect="non-scaling-stroke" />}
        <line data-testid={`wall-element-hit-${id}`} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="transparent" strokeWidth={14}
          vectorEffect="non-scaling-stroke"
          onPointerDown={(event) => {
            if (!selectable || !shouldConsumePointerDown(event)) return;
            event.stopPropagation();
            activate();
          }} />
      </g>;
    })}
  </g>;
}
