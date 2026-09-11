import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore.ts';
import { reopenProject } from '@/api/projectApi.ts';
import styles from './BuildingTemplateDialog.module.css';

export function ReadOnlyDialog() {
  const open = useEditorStore((state) => state.readOnlyPromptOpen);
  const close = () => useEditorStore.getState().setReadOnlyPromptOpen(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { if (busy) dialog.current?.focus(); }, [busy]);
  useEffect(() => {
    if (!open) return;
    setError('');
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector('button')?.focus();
    return () => previous?.focus();
  }, [open]);
  if (!open) return null;
  return <div className={styles.backdrop}>
    <div ref={dialog} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="readonly-title"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !busy) close();
        if (event.key === 'Tab') {
          const buttons = [...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          event.preventDefault();
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
      }}>
      <h2 id="readonly-title">项目已完成</h2>
      <p>项目已完成，重新打开后才能修改</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
      <button disabled={busy} onClick={close}>取消</button>
      <button className={styles.primary} disabled={busy} onClick={async () => {
        const current = useEditorStore.getState().buildingDocument;
        if (!current || busy) return;
        setBusy(true); setError('');
        try {
          const reopened = await reopenProject(current.building_id);
          if (useEditorStore.getState().buildingDocument?.building_id === current.building_id) {
            useEditorStore.getState().loadBuilding(reopened);
          }
        } catch (reason) { setError(reason instanceof Error ? reason.message : '重新打开失败'); }
        finally { setBusy(false); }
      }}>{busy ? '正在重新打开…' : '重新打开并编辑'}</button>
      </div>
    </div>
  </div>;
}
