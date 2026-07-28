import type { SnapResult } from '@/editor/cad/snapEngine.ts';
import type { WallCommandState } from '@/editor/commands/wallCommand.ts';
import type { BuildingVertex } from '@/editor/domain/buildingTypes.ts';

interface OverlayLayerProps {
  command: WallCommandState;
  pixelsPerMm: number;
  snap?: SnapResult;
  vertexDragPreview?: BuildingVertex | null;
}

export function OverlayLayer({
  command,
  pixelsPerMm,
  snap = { kind: 'none' },
  vertexDragPreview = null,
}: OverlayLayerProps) {
  if (command.phase !== 'drawing' && snap.kind === 'none') return null;
  return (
    <g aria-label="绘制预览">
      {command.phase === 'drawing' && (
        <>
          <line
            data-testid="wall-preview"
            x1={command.start.point.x_mm}
            y1={command.start.point.y_mm}
            x2={command.previewEnd.x_mm}
            y2={command.previewEnd.y_mm}
            stroke="#2563eb"
            strokeWidth={2 / pixelsPerMm}
            strokeDasharray={`${8 / pixelsPerMm} ${5 / pixelsPerMm}`}
          />
          <circle
            cx={command.start.point.x_mm}
            cy={command.start.point.y_mm}
            r={5 / pixelsPerMm}
            fill="#2563eb"
          />
          <circle
            cx={command.previewEnd.x_mm}
            cy={command.previewEnd.y_mm}
            r={5 / pixelsPerMm}
            fill="#f59e0b"
          />
        </>
      )}
      <SnapMarker snap={snap} pixelsPerMm={pixelsPerMm} />
      {vertexDragPreview && (
        <circle
          data-testid="vertex-drag-preview"
          cx={vertexDragPreview.x_mm}
          cy={vertexDragPreview.y_mm}
          r={7 / pixelsPerMm}
          fill="none"
          stroke="#dc2626"
          strokeWidth={2 / pixelsPerMm}
          strokeDasharray={`${4 / pixelsPerMm} ${3 / pixelsPerMm}`}
        />
      )}
    </g>
  );
}

function SnapMarker({
  snap,
  pixelsPerMm,
}: {
  snap: SnapResult;
  pixelsPerMm: number;
}) {
  if (snap.kind === 'none') return null;
  const size = 7 / pixelsPerMm;
  const strokeWidth = 2 / pixelsPerMm;
  const { x_mm: x, y_mm: y } = snap.point;

  if (snap.kind === 'vertex') {
    return (
      <rect
        data-testid="snap-marker-vertex"
        aria-label="顶点吸附"
        role="img"
        x={x - size}
        y={y - size}
        width={size * 2}
        height={size * 2}
        fill="none"
        stroke="#16a34a"
        strokeWidth={strokeWidth}
      />
    );
  }
  if (snap.kind === 'intersection') {
    return (
      <g
        data-testid="snap-marker-intersection"
        aria-label="交点吸附"
        role="img"
        stroke="#dc2626"
        strokeWidth={strokeWidth}
      >
        <line x1={x - size} y1={y - size} x2={x + size} y2={y + size} />
        <line x1={x - size} y1={y + size} x2={x + size} y2={y - size} />
      </g>
    );
  }
  if (snap.kind === 'wall_projection') {
    return (
      <path
        data-testid="snap-marker-wall_projection"
        aria-label="墙上投影吸附"
        role="img"
        d={`M ${x - size} ${y - size} L ${x + size} ${y - size} L ${x} ${
          y + size
        } Z`}
        fill="none"
        stroke="#7c3aed"
        strokeWidth={strokeWidth}
      />
    );
  }
  return (
    <circle
      data-testid="snap-marker-grid"
      aria-label="网格吸附"
      role="img"
      cx={x}
      cy={y}
      r={size}
      fill="none"
      stroke="#0891b2"
      strokeWidth={strokeWidth}
      strokeDasharray={`${2 / pixelsPerMm} ${2 / pixelsPerMm}`}
    />
  );
}
