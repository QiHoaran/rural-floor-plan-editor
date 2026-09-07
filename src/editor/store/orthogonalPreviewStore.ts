import { create } from 'zustand';
import type { BuildingDocument, BuildingVertex } from '../domain/buildingTypes.ts';
import type { OrthogonalRepairResult } from '../commands/orthogonalRepair.ts';

export interface OrthogonalPreview {
  source: BuildingDocument;
  result: Extract<OrthogonalRepairResult, { ok: true }>;
}
export const useOrthogonalPreviewStore = create<{
  focusRequest: { source: BuildingDocument; points: BuildingVertex[] } | null;
  focus: (request: { source: BuildingDocument; points: BuildingVertex[] }) => void;
  preview: OrthogonalPreview | null;
  setPreview: (preview: OrthogonalPreview | null) => void;
}>((set) => ({ preview: null, focusRequest: null, focus: (focusRequest) => set({ focusRequest }), setPreview: (preview) => set({ preview }) }));
