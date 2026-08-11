import { useEffect, useRef } from 'react';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import { autosaveProject, ApiError } from '@/api/projectApi.ts';

interface UseServerAutoSaveOptions {
  buildingId: string | null;
  document: BuildingDocument | null;
  changeVersion: number;
  onSaving: () => void;
  onSaved: (
    document: BuildingDocument,
    savedChangeVersion: number,
  ) => BuildingDocument | null | void;
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
  const changeVersionRef = useRef(changeVersion);
  const timerRef = useRef<number | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const callbacksRef = useRef({ onSaving, onSaved, onError, onConflict });
  documentRef.current = document;
  changeVersionRef.current = changeVersion;
  callbacksRef.current = { onSaving, onSaved, onError, onConflict };

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    chainRef.current = Promise.resolve();
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [buildingId]);

  useEffect(() => {
    if (!buildingId || !documentRef.current || changeVersion === 0) return;
    const status = documentRef.current.workflow?.status ??
      documentRef.current.metadata?.status;
    if (status === 'complete') return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const generation = generationRef.current;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      chainRef.current = chainRef.current.then(async () => {
        if (generationRef.current !== generation) return;
        const documentToSave = documentRef.current;
        const versionToSave = changeVersionRef.current;
        if (!documentToSave) return;
        const controller = new AbortController();
        controllerRef.current = controller;
        callbacksRef.current.onSaving();
        try {
          const saved = await autosaveProject(
            buildingId,
            documentToSave,
            controller.signal,
          );
          if (
            controller.signal.aborted ||
            generationRef.current !== generation
          ) {
            return;
          }
          const reconciled = callbacksRef.current.onSaved(
            saved,
            versionToSave,
          );
          documentRef.current = reconciled ?? saved;
        } catch (error) {
          if (
            controller.signal.aborted ||
            generationRef.current !== generation
          ) {
            return;
          }
          if (
            error instanceof ApiError &&
            error.code === 'REVISION_CONFLICT'
          ) {
            callbacksRef.current.onConflict?.(0, 0);
          }
          callbacksRef.current.onError(error);
        } finally {
          if (controllerRef.current === controller) {
            controllerRef.current = null;
          }
        }
      });
    }, 800);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [buildingId, changeVersion]);
}
