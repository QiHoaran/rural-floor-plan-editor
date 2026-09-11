import type { ReactNode, SyntheticEvent } from 'react';
import { useEditorStore } from '../store/editorStore.ts';

/** Stop editing controls before they change local drafts or start API calls. */
export function EditGuard({ children }: { children: ReactNode }) {
  const guard = (event: SyntheticEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-readonly-view]')) return;
    if (!target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    if (!useEditorStore.getState().requestEdit()) {
      event.preventDefault(); event.stopPropagation();
    }
  };
  return <div onPointerDownCapture={guard} onClickCapture={guard} onChangeCapture={guard}
    onBeforeInputCapture={guard}
    onBlurCapture={(event) => {
      const state = useEditorStore.getState();
      if (state.editingSuspended || state.buildingDocument?.workflow.status === 'complete' || state.buildingDocument?.metadata.status === 'complete') event.stopPropagation();
    }}
    onKeyDownCapture={(event) => {
      if (!['Tab', 'Escape'].includes(event.key) && !(event.ctrlKey && event.key.toLowerCase() === 'c')) guard(event);
    }}>{children}</div>;
}
