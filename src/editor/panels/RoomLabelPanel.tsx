// ============================================================
// 房间标注面板 — 支持单房间编辑、多选批量标注、房间标注刷
// ============================================================

import { useMemo } from 'react';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import {
  ROOM_FUNCTION_DICTIONARY,
  getRoomFunctionName,
  getRoomFunctionColor,
} from '@/editor/domain/constants.ts';
import { getNextUnlabeledFaceId } from '@/editor/domain/buildingStatistics.ts';
import type { BuildingFace } from '@/editor/domain/buildingTypes.ts';
import styles from './RoomLabelPanel.module.css';

export function RoomLabelPanel() {
  const document = useEditorStore((state) => state.buildingDocument);
  const selection = useEditorStore((state) => state.selection);
  const multiSelection = useEditorStore((state) => state.multiSelection);
  const tool = useEditorStore((state) => state.tool);
  const brushCode = useEditorStore((state) => state.brushFunctionCode);
  const setBrushCode = useEditorStore((state) => state.setBrushFunctionCode);
  const setSelection = useEditorStore((state) => state.setSelection);
  const transact = useEditorStore((state) => state.transact);

  // 当前选中面（hooks 必须在条件判断之前）
  const selectedFace: BuildingFace | null =
    document && selection?.type === 'face' && selection.id
      ? document.faces[selection.id] ?? null
      : null;

  // 多选面
  const multiFaces = useMemo(() => {
    if (!document) return [];
    return multiSelection
    return multiSelection
      .filter((s) => s.type === 'face')
      .map((s) => ({ id: s.id, face: document.faces[s.id] }))
      .filter((f) => f.face);
  }, [multiSelection, document.faces]);

  // 标注刷模式
  const isBrushMode = tool === 'room_label_brush';

  if (!document) return null;

  const applyFunction = (faceId: string, code: string) => {
    const entry = ROOM_FUNCTION_DICTIONARY.find((e) => e.code === code);
    if (!entry) return;

    transact(`标注房间为 ${entry.name}`, (current) => ({
      ...current,
      faces: {
        ...current.faces,
        [faceId]: {
          ...current.faces[faceId],
          function_code: code,
          display_name: entry.name,
          color: entry.color,
          heated: entry.residential,
          occupied: entry.residential,
        },
      },
    }));
  };

  const applyBatchFunction = (code: string) => {
    if (multiFaces.length === 0) return;

    const entry = ROOM_FUNCTION_DICTIONARY.find((e) => e.code === code);
    if (!entry) return;

    transact(`批量标注 ${multiFaces.length} 个房间为 ${entry.name}`, (current) => {
      const updatedFaces = { ...current.faces };
      for (const { id } of multiFaces) {
        if (updatedFaces[id]) {
          updatedFaces[id] = {
            ...updatedFaces[id],
            function_code: code,
            display_name: entry.name,
            color: entry.color,
            heated: entry.residential,
            occupied: entry.residential,
          };
        }
      }
      return { ...current, faces: updatedFaces };
    });
  };

  const jumpToNextUnlabeled = () => {
    const nextId = getNextUnlabeledFaceId(
      document,
      selection?.type === 'face' ? selection.id : undefined,
    );
    if (nextId) {
      setSelection({ type: 'face', id: nextId });
    }
  };

  const jumpToPrevUnlabeled = () => {
    // 简化实现：遍历两次
    const faceIds = Object.keys(document.faces);
    if (faceIds.length === 0) return;
    const currentIndex = selection?.type === 'face'
      ? faceIds.indexOf(selection.id)
      : faceIds.length;
    const startIndex = currentIndex > 0 ? currentIndex - 1 : faceIds.length - 1;

    for (let i = startIndex; i >= 0; i--) {
      const face = document.faces[faceIds[i]];
      if (!face.function_code || face.function_code === 'unknown') {
        setSelection({ type: 'face', id: faceIds[i] });
        return;
      }
    }
    for (let i = faceIds.length - 1; i > startIndex; i--) {
      const face = document.faces[faceIds[i]];
      if (!face.function_code || face.function_code === 'unknown') {
        setSelection({ type: 'face', id: faceIds[i] });
        return;
      }
    }
  };

  return (
    <aside className={styles.panel}>
      {/* 标注刷模式指示器 */}
      {isBrushMode && (
        <div className={styles.brushIndicator}>
          <span>🖌 标注刷模式</span>
          <span style={{ color: getRoomFunctionColor(brushCode) }}>
            {getRoomFunctionName(brushCode)}
          </span>
          <button
            className={styles.brushBtn}
            onClick={() =>
              useEditorStore.getState().setTool('select')
            }
          >
            退出 (Esc)
          </button>
        </div>
      )}

      {/* 刷子功能选择器 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          {isBrushMode ? '标注刷功能' : '房间功能'}
        </div>
        <div className={styles.functionGrid}>
          {ROOM_FUNCTION_DICTIONARY.map((entry) => (
            <button
              key={entry.code}
              className={`${styles.functionBtn} ${
                brushCode === entry.code && isBrushMode
                  ? styles.active
                  : ''
              }`}
              style={{
                borderColor: entry.color,
                background:
                  brushCode === entry.code && isBrushMode
                    ? entry.color + '30'
                    : 'transparent',
              }}
              onClick={() => {
                if (isBrushMode) {
                  setBrushCode(entry.code);
                } else if (selectedFace) {
                  applyFunction(selection!.id, entry.code);
                } else if (multiFaces.length > 0) {
                  applyBatchFunction(entry.code);
                }
              }}
              title={`${entry.name} (${entry.code})`}
            >
              <span
                className={styles.colorDot}
                style={{ background: entry.color }}
              />
              <span className={styles.functionName}>{entry.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 当前选中房间属性 */}
      {selectedFace && !isBrushMode && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            房间属性: {getRoomFunctionName(selectedFace.function_code)}
          </div>
          <div className={styles.properties}>
            <label className={styles.field}>
              <span>功能</span>
              <span className={styles.value}>
                {getRoomFunctionName(selectedFace.function_code)}
              </span>
            </label>
            <label className={styles.field}>
              <span>面积</span>
              <span className={styles.value}>
                {(selectedFace.area_mm2 / 1_000_000).toFixed(2)} m²
              </span>
            </label>
            <label className={styles.field}>
              <span>采暖</span>
              <input
                type="checkbox"
                checked={selectedFace.heated ?? false}
                onChange={(e) => {
                  if (!selection?.id) return;
                  transact('修改采暖属性', (current) => ({
                    ...current,
                    faces: {
                      ...current.faces,
                      [selection.id]: {
                        ...current.faces[selection.id],
                        heated: e.target.checked,
                      },
                    },
                  }));
                }}
              />
            </label>
            <label className={styles.field}>
              <span>有人使用</span>
              <input
                type="checkbox"
                checked={selectedFace.occupied ?? false}
                onChange={(e) => {
                  if (!selection?.id) return;
                  transact('修改占用属性', (current) => ({
                    ...current,
                    faces: {
                      ...current.faces,
                      [selection.id]: {
                        ...current.faces[selection.id],
                        occupied: e.target.checked,
                      },
                    },
                  }));
                }}
              />
            </label>
          </div>
        </div>
      )}

      {/* 多选信息 */}
      {multiFaces.length > 0 && !isBrushMode && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            已选择 {multiFaces.length} 个房间
          </div>
          <div className={styles.multiInfo}>
            点击上方功能按钮可批量标注
          </div>
        </div>
      )}

      {/* 快捷跳转 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>快捷操作</div>
        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={jumpToNextUnlabeled}
          >
            ▶ 下一个未标注 (Tab)
          </button>
          <button
            className={styles.actionBtn}
            onClick={jumpToPrevUnlabeled}
          >
            ◀ 上一个未标注 (Shift+Tab)
          </button>
        </div>
      </div>
    </aside>
  );
}
