import type { BuildingDocument } from './buildingTypes.ts';

export type WallLengthAnchor = 'start' | 'end';

export function updateWallLength(
  document: BuildingDocument,
  wallId: string,
  lengthMm: number,
  fixedAnchor: WallLengthAnchor,
): BuildingDocument {
  assertSafeMillimeter(lengthMm, '墙体长度');
  if (lengthMm < 100) {
    throw new Error('墙体长度不能小于 0.10 m');
  }
  const wall = document.walls[wallId];
  if (!wall) {
    throw new Error(`墙体 ${wallId} 不存在`);
  }
  const start = document.vertices[wall.start_vertex_id];
  const end = document.vertices[wall.end_vertex_id];
  if (!start || !end) {
    throw new Error(`墙体 ${wallId} 的端点不存在`);
  }
  assertSafeMillimeter(start.x_mm, '起点 X');
  assertSafeMillimeter(start.y_mm, '起点 Y');
  assertSafeMillimeter(end.x_mm, '终点 X');
  assertSafeMillimeter(end.y_mm, '终点 Y');

  const dx = end.x_mm - start.x_mm;
  const dy = end.y_mm - start.y_mm;
  const currentLength = Math.hypot(dx, dy);
  if (currentLength === 0) {
    throw new Error(`墙体 ${wallId} 为零长度墙体`);
  }
  const unitX = dx / currentLength;
  const unitY = dy / currentLength;

  const vertices = { ...document.vertices };
  if (fixedAnchor === 'start') {
    const nextEnd = {
      x_mm: Math.round(start.x_mm + unitX * lengthMm),
      y_mm: Math.round(start.y_mm + unitY * lengthMm),
    };
    assertSafeMillimeter(nextEnd.x_mm, '终点 X');
    assertSafeMillimeter(nextEnd.y_mm, '终点 Y');
    vertices[wall.end_vertex_id] = nextEnd;
  } else {
    const nextStart = {
      x_mm: Math.round(end.x_mm - unitX * lengthMm),
      y_mm: Math.round(end.y_mm - unitY * lengthMm),
    };
    assertSafeMillimeter(nextStart.x_mm, '起点 X');
    assertSafeMillimeter(nextStart.y_mm, '起点 Y');
    vertices[wall.start_vertex_id] = nextStart;
  }
  return { ...document, vertices };
}

function assertSafeMillimeter(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} 必须是有限的毫米安全整数`);
  }
}
