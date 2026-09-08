// ============================================================
// 编辑器懒加载边界
// 入口 chunk 只保留这个极小的模块：editorStore → buildingValidation →
// topology/connectivity 整个图（约 2,300 行）与 zustand 都随异步块加载，
// 索引页首屏不再为编辑器付出解析与请求成本。
// ============================================================

import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';

let storeModule: Promise<typeof import('@/editor/store/editorStore.ts')> | null = null;

const loadStore = () => (storeModule ??= import('@/editor/store/editorStore.ts').catch((error) => {
  // 加载失败不缓存被拒绝的 Promise，允许用户重试。
  storeModule = null;
  throw error;
}));

export async function loadEditorDocument(document: BuildingDocument): Promise<void> {
  (await loadStore()).useEditorStore.getState().loadBuilding(document);
}

export async function closeEditorDocument(): Promise<void> {
  (await loadStore()).useEditorStore.getState().closeBuilding();
}
