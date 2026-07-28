import { useEffect, useRef } from 'react';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import { autosaveProject, ApiError } from '@/api/projectApi.ts';

interface UseServerAutoSaveOptions {
  buildingId: string | null;
  document: BuildingDocument | null;
  changeVersion: number;
  onSaving: () => void;
  onSaved: (document: BuildingDocument) => void;
  onError: (error: unknown) => void;
  onConflict?: (serverRevision: number, clientRevision: number) => void;
}

export function useServerAutoSave({
  buildingId,
  document,
  changeVersion,
  onSaving,
  onSaved,
  onError,
  onConflict,
}: UseServerAutoSaveOptions): void {
  const documentRef = useRef(document);
  const callbacksRef = useRef({ onSaving, onSaved, onError, onConflict });
  documentRef.current = document;
  callbacksRef.current = { onSaving, onSaved, onError, onConflict };

  useEffect(() => {
    if (!buildingId || !documentRef.current || changeVersion === 0) return;

    // 只自动保存 draft、pending_review 和 reviewed 状态
    const status = documentRef.current.workflow?.status ??
      documentRef.current.metadata?.status;
    if (status === 'complete') return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const documentToSave = documentRef.current;
      if (!documentToSave) return;
      callbacksRef.current.onSaving();
      try {
        const saved = await autosaveProject(
          buildingId,
          documentToSave,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          callbacksRef.current.onSaved(saved);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (
          error instanceof ApiError &&
          error.code === 'REVISION_CONFLICT'
        ) {
          // 版本冲突：停止自动保存
          callbacksRef.current.onConflict?.(
            // 从错误信息中提取 server revision（简化处理）
            0, 0,
          );
          callbacksRef.current.onError(error);
          return;
        }
        callbacksRef.current.onError(error);
      }
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [buildingId, changeVersion]);
}
