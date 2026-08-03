// ============================================================
// 自动保存 Hook
// ============================================================

import { useEffect, useRef } from 'react';
import { usePlanStore } from '@/editor/store/planStore.ts';
import { saveProject, loadProject } from '@/storage/indexedDb.ts';
import { AUTO_SAVE_DELAY_MS } from '@/editor/domain/constants.ts';

export function useAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = usePlanStore.subscribe((state) => {
      // 只在 unsaved 状态时触发自动保存
      if (state.saveStatus !== 'unsaved') return;

      // 防抖
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(async () => {
        if (isSavingRef.current) return;
        isSavingRef.current = true;

        try {
          usePlanStore.getState().setSaveStatus('saving');
          await saveProject(state.planDocument);
          usePlanStore.getState().setSaveStatus('saved');
          usePlanStore.getState().setSaveError(null);
        } catch (err) {
          usePlanStore.getState().setSaveStatus('error');
          usePlanStore.getState().setSaveError((err as Error).message);
        } finally {
          isSavingRef.current = false;
        }
      }, AUTO_SAVE_DELAY_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}

/**
 * 在应用启动时加载已保存的项目
 */
export async function loadSavedProject() {
  const doc = await loadProject();
  if (doc) {
    usePlanStore.getState().setPlanDocument(doc);
    usePlanStore.getState().setSaveStatus('saved');
    return true;
  }
  return false;
}
