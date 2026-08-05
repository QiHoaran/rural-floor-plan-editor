import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import { updateWallElement } from '@/editor/commands/wallElementCommand.ts';
import {
  formatWallElementDimensions,
  parseWallElementDimensions,
} from '@/editor/domain/wallElementDimensions.ts';
import styles from './EditablePropertyPanel.module.css';

export function ConnectivityPanel({ elementId }: { elementId: string }) {
  const document = useEditorStore((state) => state.buildingDocument)!;
  const transact = useEditorStore((state) => state.transact);
  const element = document.wall_elements[elementId];
  const relation = document.relations.find((item) => item.wall_element_id === elementId);
  const [dimensions, setDimensions] = useState(
    formatWallElementDimensions(element.width_mm, element.height_mm),
  );
  const [error, setError] = useState('');
  const editingDimensions = useRef(false);
  const previousElementId = useRef(elementId);

  useEffect(() => {
    const stored = formatWallElementDimensions(
      element.width_mm,
      element.height_mm,
    );
    const changedElement = previousElementId.current !== elementId;
    previousElementId.current = elementId;
    if (changedElement || !editingDimensions.current) setDimensions(stored);
    if (changedElement) {
      editingDimensions.current = false;
      setError('');
    }
  }, [
    elementId,
    element.width_mm,
    element.height_mm,
  ]);

  const commitDimensions = () => {
    editingDimensions.current = false;
    const parsed = parseWallElementDimensions(dimensions);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    const currentDocument = useEditorStore.getState().buildingDocument;
    const currentElement = currentDocument?.wall_elements[elementId];
    if (!currentDocument || !currentElement) return;
    if (
      currentElement.width_mm === parsed.widthMm &&
      currentElement.height_mm === parsed.heightMm
    ) {
      setDimensions(parsed.normalized);
      setError('');
      return;
    }
    const result = updateWallElement(currentDocument, elementId, {
      width_mm: parsed.widthMm,
      height_mm: parsed.heightMm,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    transact('修改门窗宽度和高度', () => result.document);
    setDimensions(parsed.normalized);
    setError('');
  };
  return <aside className={styles.panel}>
    <div className={styles.header}>Wall element</div>
    <div className={styles.content}>
      <div className={styles.readOnly}>{elementId}</div>
      <div>{element.element_type}</div>
      <div>Host: {element.host_wall_id}</div>
      <div>Status: {element.status}</div>
      <label className={styles.field}>
        <span>尺寸（宽×高，米）</span>
        <input aria-label="尺寸（宽×高，米）" value={dimensions}
          placeholder="1.0×2.1"
          onFocus={() => { editingDimensions.current = true; }}
          onChange={(event) => setDimensions(event.target.value)}
          onBlur={commitDimensions}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }} />
      </label>
      {relation && <div>
        {relation.relation_type}: {relation.from_face_id} →{' '}
        {relation.to.kind === 'outside' ? 'outside' : relation.to.face_id}
        <br />
        {Object.entries(relation.channels).filter(([, enabled]) => enabled)
          .map(([channel]) => channel).join(', ')}
      </div>}
      {error && <div className={styles.error} role="alert">{error}</div>}
    </div>
  </aside>;
}
