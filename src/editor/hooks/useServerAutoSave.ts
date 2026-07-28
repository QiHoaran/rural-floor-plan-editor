import { useEffect, useRef } from 'react';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import { autosaveProject } from '@/api/projectApi.ts';

interface UseServerAutoSaveOptions {
  buildingId: string | null;
  document: BuildingDocument | null;
  changeVersion: number;
  onSaving: () => void;
  onSaved: (document: BuildingDocument) => void;
  onError: (error: unknown) => void;
}

export function useServerAutoSave({
  buildingId,
  document,
  changeVersion,
  onSaving,
  onSaved,
  onError,
}: UseServerAutoSaveOptions): void {
  const documentRef = useRef(document);
  const callbacksRef = useRef({ onSaving, onSaved, onError });
  documentRef.current = document;
  callbacksRef.current = { onSaving, onSaved, onError };

  useEffect(() => {
    if (!buildingId || !documentRef.current || changeVersion === 0) return;

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
        if (!controller.signal.aborted) {
          callbacksRef.current.onError(error);
        }
      }
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [buildingId, changeVersion]);
}
