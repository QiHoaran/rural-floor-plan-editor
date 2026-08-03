import { useRef, useState } from 'react';
import type {
  BuildingDocument,
  WallElementType,
} from '@/editor/domain/buildingTypes.ts';
import {
  exteriorSideSign,
  wallElementRect,
} from '@/editor/domain/wallElementGeometry.ts';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface Props {
  document: BuildingDocument;
  pixelsPerMm: number;
  selectedElementId: string | null;
  onSelectElement: (elementId: string) => void;
  selectable?: boolean;
  shouldConsumePointerDown?: (
    event: ReactPointerEvent<SVGElement>,
  ) => boolean;
  /** 指针事件 → 世界坐标（拖拽移动构件时投影到宿主墙） */
  worldPointFromEvent?: (
    event: ReactPointerEvent<SVGElement>,
  ) => { x_mm: number; y_mm: number };
  /** 拖拽结束提交新的 offset_from_start_mm */
  onCommitElementOffset?: (elementId: string, offsetFromStartMm: number) => void;
}

const LABELS: Record<WallElementType, string> = {
  exterior_door: 'Exterior door',
  exterior_window: 'Exterior window',
  interior_door: 'Interior door',
  passage: 'Passage',
};

const COLORS: Record<WallElementType, string> = {
  exterior_door: '#f97316',
  exterior_window: '#0891b2',
  interior_door: '#2563eb',
  passage: '#9333ea',
};

/** 内门两端深色竖线的颜色 */
const DOOR_MARK_COLOR = '#0f172a';

const END_CLEARANCE_MM = 100;

interface DragState {
  elementId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
}

export function WallElementLayer({
  document,
  pixelsPerMm: _pixelsPerMm,
  selectedElementId,
  onSelectElement,
  selectable = true,
  shouldConsumePointerDown = (event) => event.button === 0,
  worldPointFromEvent,
  onCommitElementOffset,
}: Props) {
  const [previewOffsets, setPreviewOffsets] = useState<Record<string, number>>({});
  const dragRef = useRef<DragState | null>(null);

  return <g aria-label="Wall elements">
    {Object.entries(document.wall_elements).map(([id, element]) => {
      const wall = document.walls[element.host_wall_id];
      const start = wall && document.vertices[wall.start_vertex_id];
      const end = wall && document.vertices[wall.end_vertex_id];
      if (!wall || !start || !end) return null;
      const length = Math.hypot(end.x_mm - start.x_mm, end.y_mm - start.y_mm);
      if (!Number.isFinite(length) || length === 0) return null;

      const effectiveOffset = previewOffsets[id] ?? element.offset_from_start_mm;
      const rect = wallElementRect(
        start,
        end,
        effectiveOffset,
        element.width_mm,
        wall.thickness_mm,
      );
      const { corners, ux, uy, nx, ny, halfDepth } = rect;
      const color = COLORS[element.element_type];
      const points = corners.map((c) => `${c.x_mm},${c.y_mm}`).join(' ');
      const x1 = start.x_mm + ux * effectiveOffset;
      const y1 = start.y_mm + uy * effectiveOffset;
      const x2 = x1 + ux * element.width_mm;
      const y2 = y1 + uy * element.width_mm;
      const activate = () => selectable && onSelectElement(id);

      // 外门：门弧朝室外侧
      let swingSign = 1;
      if (element.element_type === 'exterior_door') {
        swingSign = exteriorSideSign(document, id) ?? 1;
      }
      const snx = nx * swingSign;
      const sny = ny * swingSign;
      const swingPath =
        element.element_type === 'exterior_door'
          ? `M ${x1 + snx * halfDepth} ${y1 + sny * halfDepth} ` +
            `Q ${x1 + snx * (halfDepth + element.width_mm * 0.7) + ux * element.width_mm * 0.3} ` +
            `${y1 + sny * (halfDepth + element.width_mm * 0.7) + uy * element.width_mm * 0.3} ` +
            `${x1 + snx * (halfDepth + element.width_mm)} ${y1 + sny * (halfDepth + element.width_mm)}`
          : '';

      // 内门：完整实心矩形 + 两端深色竖线（|==|）
      const markWidth = Math.max(16, halfDepth * 0.2);

      const handlePointerDown = (event: ReactPointerEvent<SVGElement>) => {
        if (!selectable || !shouldConsumePointerDown(event)) return;
        event.stopPropagation();
        activate();
        if (!worldPointFromEvent) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = {
          elementId: id,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
        };
      };

      const handlePointerMove = (event: ReactPointerEvent<SVGElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.elementId !== id || drag.pointerId !== event.pointerId) return;
        if (!worldPointFromEvent) return;
        const moved = Math.hypot(
          event.clientX - drag.startClientX,
          event.clientY - drag.startClientY,
        );
        if (moved < 4) return;
        const point = worldPointFromEvent(event);
        const dx = end.x_mm - start.x_mm;
        const dy = end.y_mm - start.y_mm;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= 0) return;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((point.x_mm - start.x_mm) * dx + (point.y_mm - start.y_mm) * dy) /
              lengthSquared,
          ),
        );
        let offset = t * Math.sqrt(lengthSquared) - element.width_mm / 2;
        offset = Math.max(
          END_CLEARANCE_MM,
          Math.min(length - END_CLEARANCE_MM - element.width_mm, offset),
        );
        setPreviewOffsets((current) => ({ ...current, [id]: offset }));
      };

      const handlePointerUp = (event: ReactPointerEvent<SVGElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.elementId !== id || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        const offset = previewOffsets[id];
        if (offset !== undefined && onCommitElementOffset) {
          const rounded = Math.round(offset);
          if (rounded !== element.offset_from_start_mm) {
            onCommitElementOffset(id, rounded);
          }
        }
        setPreviewOffsets((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      };

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
        <polygon
          data-testid={`wall-element-rect-${id}`}
          points={points}
          fill={color}
          fillOpacity={element.element_type === 'passage' ? 0.9 : 0.85}
          stroke="none" />
        {element.element_type === 'interior_door' && <g
          data-testid={`wall-element-door-marks-${id}`}
          stroke={DOOR_MARK_COLOR}
          strokeWidth={markWidth}
          strokeLinecap="butt">
          <line data-testid={`wall-element-door-mark-start-${id}`}
            x1={x1 - nx * halfDepth} y1={y1 - ny * halfDepth}
            x2={x1 + nx * halfDepth} y2={y1 + ny * halfDepth} />
          <line data-testid={`wall-element-door-mark-end-${id}`}
            x1={x2 - nx * halfDepth} y1={y2 - ny * halfDepth}
            x2={x2 + nx * halfDepth} y2={y2 + ny * halfDepth} />
        </g>}
        {element.element_type === 'exterior_door' && <path
          data-testid={`wall-element-swing-${id}`}
          d={swingPath}
          stroke={color}
          fill="none"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke" />}
        {selectedElementId === id && <polygon
          points={points}
          fill="none"
          stroke="#0f172a"
          strokeWidth={4}
          strokeOpacity={0.45}
          vectorEffect="non-scaling-stroke" />}
        <polygon data-testid={`wall-element-hit-${id}`} points={points}
          fill="transparent" stroke="transparent"
          strokeWidth={14}
          vectorEffect="non-scaling-stroke"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp} />
      </g>;
    })}
  </g>;
}
