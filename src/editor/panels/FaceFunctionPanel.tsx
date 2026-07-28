import { useEffect, useRef, useState } from 'react';
import {
  assignFaceFunction,
  createAndAssignCustomFaceFunction,
  RURAL_FACE_FUNCTION_PRESETS,
  type FaceFunctionType,
} from '@/editor/domain/faceFunctions.ts';
import { markFaceAsOutside } from '@/editor/topology/outsideRegions.ts';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import styles from './FaceFunctionPanel.module.css';

export function FaceFunctionPanel({ faceId }: { faceId: string }) {
  const document = useEditorStore((state) => state.buildingDocument)!;
  const transact = useEditorStore((state) => state.transact);
  const setSelection = useEditorStore((state) => state.setSelection);
  const face = document.faces[faceId];
  const [localName, setLocalName] = useState(face?.local_name ?? '');
  const [notes, setNotes] = useState(face?.notes ?? '');
  const [customName, setCustomName] = useState('');
  const [customColor, setCustomColor] = useState('#94a3b8');
  const [error, setError] = useState('');
  const [confirmOutside, setConfirmOutside] = useState(false);
  const previousFaceId = useRef(faceId);
  const localNameEdit = useRef({ focused: false, dirty: false });
  const notesEdit = useRef({ focused: false, dirty: false });

  useEffect(() => {
    const switchedFace = previousFaceId.current !== faceId;
    if (
      switchedFace ||
      !localNameEdit.current.focused ||
      !localNameEdit.current.dirty
    ) {
      setLocalName(face?.local_name ?? '');
    }
    if (
      switchedFace ||
      !notesEdit.current.focused ||
      !notesEdit.current.dirty
    ) {
      setNotes(face?.notes ?? '');
    }
    if (switchedFace) {
      localNameEdit.current = { focused: false, dirty: false };
      notesEdit.current = { focused: false, dirty: false };
      setCustomName('');
      setError('');
      setConfirmOutside(false);
    }
    previousFaceId.current = faceId;
  }, [face?.local_name, face?.notes, faceId]);

  if (!face) return null;
  const functionTypes: FaceFunctionType[] = [
    ...RURAL_FACE_FUNCTION_PRESETS,
    ...document.custom_function_types,
  ];

  const assign = (code: string) => {
    const functionType = functionTypes.find((item) => item.code === code);
    if (!functionType) return;
    transact('设置功能面类型', (current) => ({
      ...current,
      faces: {
        ...current.faces,
        [faceId]: assignFaceFunction(current.faces[faceId], functionType),
      },
    }));
  };

  const updateFace = (
    description: string,
    property: 'local_name' | 'notes' | 'color',
    value: string,
  ) => {
    transact(description, (current) => {
      const currentFace = current.faces[faceId];
      if (!currentFace || currentFace[property] === value) return current;
      return {
        ...current,
        faces: {
          ...current.faces,
          [faceId]: { ...currentFace, [property]: value },
        },
      };
    });
  };

  const addCustom = () => {
    if (!customName.trim()) {
      setError('名称不能为空');
      return;
    }
    transact('添加自定义功能面类型', (current) => {
      const result = createAndAssignCustomFaceFunction(
        current,
        faceId,
        customName,
        customColor,
      );
      return result.ok ? result.document : current;
    });
    setError('');
    setCustomName('');
  };

  const confirmMarkOutside = () => {
    let changed = false;
    transact('标记院落外部区域', (current) => {
      const result = markFaceAsOutside(current, faceId);
      changed = result.ok;
      return result.ok ? result.document : current;
    });
    if (changed) setSelection(null);
    else setError('当前功能面不存在');
  };

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>功能面属性</div>
      <div className={styles.content}>
        <div className={styles.faceId}>{faceId}</div>
        <label className={styles.field}>
          <span>功能类型</span>
          <select
            aria-label="功能类型"
            value={face.function_code ?? ''}
            onChange={(event) => assign(event.target.value)}
          >
            <option value="">未指定</option>
            {functionTypes.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>本地称呼</span>
          <input
            aria-label="本地称呼"
            value={localName}
            onFocus={() => {
              localNameEdit.current.focused = true;
            }}
            onChange={(event) => {
              localNameEdit.current.dirty = true;
              setLocalName(event.target.value);
            }}
            onBlur={() => {
              const shouldCommit = localNameEdit.current.dirty;
              localNameEdit.current = { focused: false, dirty: false };
              if (shouldCommit) {
                updateFace('修改功能面称呼', 'local_name', localName);
              }
            }}
          />
        </label>
        <label className={styles.field}>
          <span>备注</span>
          <textarea
            aria-label="备注"
            value={notes}
            onFocus={() => {
              notesEdit.current.focused = true;
            }}
            onChange={(event) => {
              notesEdit.current.dirty = true;
              setNotes(event.target.value);
            }}
            onBlur={() => {
              const shouldCommit = notesEdit.current.dirty;
              notesEdit.current = { focused: false, dirty: false };
              if (shouldCommit) {
                updateFace('修改功能面备注', 'notes', notes);
              }
            }}
          />
        </label>
        <label className={styles.field}>
          <span>功能面颜色</span>
          <input
            aria-label="功能面颜色"
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(face.color) ? face.color : '#94a3b8'}
            onChange={(event) =>
              updateFace('修改功能面颜色', 'color', event.target.value)
            }
          />
        </label>

        <div className={styles.sectionTitle}>自定义功能</div>
        <label className={styles.field}>
          <span>名称</span>
          <input
            aria-label="自定义功能名称"
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>颜色</span>
          <input
            aria-label="自定义功能颜色"
            type="color"
            value={customColor}
            onChange={(event) => setCustomColor(event.target.value)}
          />
        </label>
        <button type="button" onClick={addCustom}>
          添加自定义功能
        </button>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.dangerZone}>
          {!confirmOutside ? (
            <button type="button" onClick={() => setConfirmOutside(true)}>
              标记为外部区域
            </button>
          ) : (
            <div className={styles.confirmRow}>
              <span>确认将此面标记为院落外部区域？</span>
              <button type="button" onClick={confirmMarkOutside}>
                确认标记
              </button>
              <button type="button" onClick={() => setConfirmOutside(false)}>
                取消
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
