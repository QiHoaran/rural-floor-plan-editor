import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import { updateWallElement } from '@/editor/commands/wallElementCommand.ts';
import styles from './EditablePropertyPanel.module.css';

export function ConnectivityPanel({ elementId }: { elementId: string }) {
  const document = useEditorStore((state) => state.buildingDocument)!;
  const transact = useEditorStore((state) => state.transact);
  const element = document.wall_elements[elementId];
  const relation = document.relations.find((item) => item.wall_element_id === elementId);
  const [values, setValues] = useState({
    offset_from_start_mm: String(element.offset_from_start_mm / 1000),
    width_mm: String(element.width_mm / 1000),
    height_mm: String(element.height_mm / 1000),
    sill_height_mm: String(element.sill_height_mm / 1000),
  });
  const [error, setError] = useState('');
  const focusedProperty = useRef<keyof typeof values | null>(null);
  const previousElementId = useRef(elementId);

  useEffect(() => {
    const stored = {
      offset_from_start_mm: String(element.offset_from_start_mm / 1000),
      width_mm: String(element.width_mm / 1000),
      height_mm: String(element.height_mm / 1000),
      sill_height_mm: String(element.sill_height_mm / 1000),
    };
    const changedElement = previousElementId.current !== elementId;
    previousElementId.current = elementId;
    setValues((current) => {
      if (changedElement || focusedProperty.current === null) return stored;
      return {
        ...stored,
        [focusedProperty.current]: current[focusedProperty.current],
      };
    });
    if (changedElement) {
      focusedProperty.current = null;
      setError('');
    }
  }, [
    elementId,
    element.offset_from_start_mm,
    element.width_mm,
    element.height_mm,
    element.sill_height_mm,
  ]);

  const commit = (property: keyof typeof values, label: string) => {
    const millimeters = Math.round(Number(values[property]) * 1000);
    focusedProperty.current = null;
    const currentDocument = useEditorStore.getState().buildingDocument;
    const currentElement = currentDocument?.wall_elements[elementId];
    if (!currentDocument || !currentElement) return;
    if (currentElement[property] === millimeters) {
      setValues((current) => ({
        ...current,
        [property]: String(millimeters / 1000),
      }));
      setError('');
      return;
    }
    const result = updateWallElement(currentDocument, elementId, {
      [property]: millimeters,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    transact(`Edit wall element ${label}`, () => result.document);
    setValues((current) => ({ ...current, [property]: String(millimeters / 1000) }));
    setError('');
  };
  const fields = [
    ['offset_from_start_mm', 'Offset (m)'],
    ['width_mm', 'Width (m)'],
    ['height_mm', 'Height (m)'],
    ['sill_height_mm', 'Sill (m)'],
  ] as const;
  return <aside className={styles.panel}>
    <div className={styles.header}>Wall element</div>
    <div className={styles.content}>
      <div className={styles.readOnly}>{elementId}</div>
      <div>{element.element_type}</div>
      <div>Host: {element.host_wall_id}</div>
      <div>Status: {element.status}</div>
      {fields.map(([property, label]) => <label className={styles.field} key={property}>
        <span>{label}</span>
        <input aria-label={label} inputMode="decimal" value={values[property]}
          onFocus={() => { focusedProperty.current = property; }}
          onChange={(event) => setValues((current) => ({ ...current, [property]: event.target.value }))}
          onBlur={() => commit(property, label)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }} />
      </label>)}
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
