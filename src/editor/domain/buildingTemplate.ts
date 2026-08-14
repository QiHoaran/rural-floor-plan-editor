import type { BuildingDocument, BuildingVertex } from './buildingTypes.ts';
import { recomputeGeometry } from './recomputeGeometry.ts';
import { insertWall, type WallCandidate } from '../topology/normalizeGraph.ts';

export interface BuildingTemplateInput {
  frontageMm: number;
  depthMm: number;
  roomCount: number;
}

export type BuildingTemplateResult =
  | { ok: true; document: BuildingDocument }
  | { ok: false; message: string };

/** 生成外墙矩形及按房间数等分的内墙，不改变任何持久化数据结构。 */
export function applyBuildingTemplate(
  document: BuildingDocument,
  input: BuildingTemplateInput,
): BuildingTemplateResult {
  if (
    !Number.isInteger(input.frontageMm) ||
    !Number.isInteger(input.depthMm) ||
    input.frontageMm < 100 ||
    input.depthMm < 100
  ) {
    return { ok: false, message: '正房开间和正房面宽必须至少为 0.1 米。' };
  }
  if (!Number.isInteger(input.roomCount) || input.roomCount < 1) {
    return { ok: false, message: '房间数必须是大于 0 的整数。' };
  }

  const floorId = document.floors[0]?.floor_id;
  if (!floorId) return { ok: false, message: '当前建筑缺少可用楼层。' };
  let next: BuildingDocument = {
    ...document,
    floors: document.floors.map((floor) => ({
      ...floor,
      wall_ids: [],
      face_ids: [],
    })),
    vertices: {},
    walls: {},
    wall_elements: {},
    faces: {},
    outside_regions: {},
    relations: [],
    validation: { issues: [] },
  };

  const point = (x_mm: number, y_mm: number): BuildingVertex => ({ x_mm, y_mm });
  const candidates: WallCandidate[] = [
    wallCandidate(document, floorId, 'exterior', point(0, 0), point(input.frontageMm, 0)),
    wallCandidate(document, floorId, 'exterior', point(input.frontageMm, 0), point(input.frontageMm, input.depthMm)),
    wallCandidate(document, floorId, 'exterior', point(input.frontageMm, input.depthMm), point(0, input.depthMm)),
    wallCandidate(document, floorId, 'exterior', point(0, input.depthMm), point(0, 0)),
  ];
  for (let index = 1; index < input.roomCount; index += 1) {
    const x = Math.round(input.frontageMm * index / input.roomCount);
    candidates.push(
      wallCandidate(
        document,
        floorId,
        'interior',
        point(x, 0),
        point(x, input.depthMm),
      ),
    );
  }

  for (const candidate of candidates) {
    const inserted = insertWall(next, candidate);
    if (!inserted.ok) {
      return { ok: false, message: '模板墙体生成失败，请检查输入尺寸。' };
    }
    next = inserted.document;
  }
  const recomputed = recomputeGeometry(next);
  if (!recomputed.ok) {
    return { ok: false, message: '模板拓扑重算失败。' };
  }
  return { ok: true, document: recomputed.document };
}

function wallCandidate(
  document: BuildingDocument,
  floorId: string,
  wallType: 'exterior' | 'interior',
  start: BuildingVertex,
  end: BuildingVertex,
): WallCandidate {
  return {
    start,
    end,
    wall_type: wallType,
    thickness_mm: document.building_defaults.wall_thickness_mm,
    height_mm: document.building_defaults.wall_height_mm,
    material_type: 'brick',
    floor_id: floorId,
  };
}
