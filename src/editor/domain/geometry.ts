// ============================================================
// 通用几何函数 — 不依赖React或Leaflet
// ============================================================

/**
 * 两点之间的距离
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * 两点之间的方向向量（单位向量）
 */
export function directionVector(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): [number, number] {
  const d = distance(x1, y1, x2, y2);
  if (d === 0) return [0, 0];
  return [(x2 - x1) / d, (y2 - y1) / d];
}

/**
 * 点到线段的投影
 * 返回投影点坐标、参数t（0~1之间的比例）和距离
 */
export function projectPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number; t: number; dist: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // 线段退化为点
    return { x: ax, y: ay, t: 0, dist: distance(px, py, ax, ay) };
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const dist = distance(px, py, projX, projY);

  return { x: projX, y: projY, t, dist };
}

/**
 * 计算两条线段的交点
 * 返回交点坐标和是否相交（在两条线段内部）
 */
export function segmentIntersection(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): { x: number; y: number; intersects: boolean; t1: number; t2: number } {
  const d1x = bx - ax;
  const d1y = by - ay;
  const d2x = dx - cx;
  const d2y = dy - cy;

  const cross = d1x * d2y - d1y * d2x;

  // 平行
  if (Math.abs(cross) < 1e-10) {
    return { x: 0, y: 0, intersects: false, t1: 0, t2: 0 };
  }

  const t1 = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
  const t2 = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;

  const intersectX = ax + t1 * d1x;
  const intersectY = ay + t1 * d1y;

  const intersects = t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1;

  return { x: intersectX, y: intersectY, intersects, t1, t2 };
}

/**
 * 判断点是否在某个tolerance内在线段上
 */
export function isPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  tolerance: number = 1,
): boolean {
  const proj = projectPointToSegment(px, py, ax, ay, bx, by);
  return proj.dist <= tolerance;
}

/**
 * 计算多边形面积（Shoelace公式）
 * 顶点按逆时针或顺时针排列
 */
export function polygonArea(vertices: [number, number][]): number {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i][0] * vertices[j][1];
    area -= vertices[j][0] * vertices[i][1];
  }
  return Math.abs(area) / 2;
}

/**
 * 计算多边形质心
 */
export function polygonCentroid(vertices: [number, number][]): [number, number] {
  let cx = 0;
  let cy = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    cx += vertices[i][0];
    cy += vertices[i][1];
  }
  return [cx / n, cy / n];
}

/**
 * 判断多边形是否简单（无自相交）
 * 使用线段交叉检测
 */
export function isSimplePolygon(vertices: [number, number][]): boolean {
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const ax = vertices[i][0];
    const ay = vertices[i][1];
    const bx = vertices[(i + 1) % n][0];
    const by = vertices[(i + 1) % n][1];

    for (let j = i + 2; j < n; j++) {
      // 跳过相邻边
      if (i === 0 && j === n - 1) continue;

      const cx = vertices[j][0];
      const cy = vertices[j][1];
      const dx = vertices[(j + 1) % n][0];
      const dy = vertices[(j + 1) % n][1];

      const inter = segmentIntersection(ax, ay, bx, by, cx, cy, dx, dy);
      if (inter.intersects) return false;
    }
  }
  return true;
}

/**
 * 计算两点之间的角度（度）
 * 0° = 水平向右，逆时针为正
 * 返回标准化到 [0, 360)
 */
export function angleDeg(x1: number, y1: number, x2: number, y2: number): number {
  const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
  return ((angle % 360) + 360) % 360;
}

/**
 * 正交约束：将目标点约束到过起点的水平或垂直线上
 * 返回约束后的坐标
 */
export function orthoConstraint(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
): [number, number] {
  const dx = Math.abs(targetX - originX);
  const dy = Math.abs(targetY - originY);

  if (dx >= dy) {
    // 水平方向优先
    return [targetX, originY];
  } else {
    // 垂直方向优先
    return [originX, targetY];
  }
}

/**
 * 45度约束：将目标点约束到过起点的45度方向
 */
export function fortyFiveConstraint(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
): [number, number] {
  const dx = targetX - originX;
  const dy = targetY - originY;
  const len = Math.max(Math.abs(dx), Math.abs(dy));
  const signX = dx >= 0 ? 1 : -1;
  const signY = dy >= 0 ? 1 : -1;

  // 判断更接近哪个45度方向
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx > absDy * 2) {
    // 接近水平
    return [targetX, originY];
  } else if (absDy > absDx * 2) {
    // 接近垂直
    return [originX, targetY];
  } else {
    // 接近45度
    return [originX + signX * len / Math.SQRT2, originY + signY * len / Math.SQRT2];
  }
}

/**
 * 计算[0, 360)范围内的角度差（最小差值）
 */
export function angleDifference(a: number, b: number): number {
  let diff = Math.abs(a - b) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * 点是否在多边形内部（射线法）
 */
export function pointInPolygon(
  px: number,
  py: number,
  vertices: [number, number][],
): boolean {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i][0];
    const yi = vertices[i][1];
    const xj = vertices[j][0];
    const yj = vertices[j][1];

    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
