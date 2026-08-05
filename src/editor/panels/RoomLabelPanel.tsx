// ============================================================
// 房间标注面板 — 支持单房间编辑、多选批量标注、房间标注刷
// ============================================================

import { useMemo, useState } from 'react';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import {
  ROOM_FUNCTION_DICTIONARY,
} from '@/editor/domain/constants.ts';
import {
  CORE_ROOM_FUNCTION_PRESETS,
  ensureRoomFunctionSnapshot,
  mergeRoomFunctionTypes,
} from '@/editor/domain/roomFunctionTemplates.ts';
import { useRoomFunctionTemplates } from '@/editor/hooks/useRoomFunctionTemplates.ts';
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
  const templateState = useRoomFunctionTemplates();
  const [templateName, setTemplateName] = useState('');
  const [templateColor, setTemplateColor] = useState('#94a3b8');
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);

  const functionTypes = useMemo(
    () => mergeRoomFunctionTypes(
      CORE_ROOM_FUNCTION_PRESETS,
      templateState.templates,
      document?.custom_function_types ?? [],
    ),
    [document?.custom_function_types, templateState.templates],
  );

  // 当前选中面（hooks 必须在条件判断之前）
  const selectedFace: BuildingFace | null =
    document && selection?.type === 'face' && selection.id
      ? document.faces[selection.id] ?? null
      : null;

  // 多选面
  const multiFaces = useMemo(() => {
    if (!document) return [];
    return multiSelection
      .filter((s) => s.type === 'face')
      .map((s) => ({ id: s.id, face: document.faces[s.id] }))
      .filter((f) => f.face);
  }, [multiSelection, document]);

  // 标注刷模式
  const isBrushMode = tool === 'room_label_brush';

  if (!document) return null;

  const applyFunction = (faceId: string, code: string) => {
    const entry = functionTypes.find((e) => e.code === code);
    if (!entry) return;
    const residential = ROOM_FUNCTION_DICTIONARY.find(
      (item) => item.code === code,
    )?.residential ?? false;
    transact(`标注房间为 ${entry.name}`, (current) => {
      const withSnapshot = ensureRoomFunctionSnapshot(current, entry);
      return {
        ...withSnapshot,
        faces: {
          ...withSnapshot.faces,
          [faceId]: {
            ...withSnapshot.faces[faceId],
            function_code: code,
            display_name: entry.name,
            color: entry.color,
            heated: residential,
            occupied: residential,
          },
        },
      };
    });
  };

  const applyBatchFunction = (code: string) => {
    if (multiFaces.length === 0) return;

    const entry = functionTypes.find((e) => e.code === code);
    if (!entry) return;
    const residential = ROOM_FUNCTION_DICTIONARY.find(
      (item) => item.code === code,
    )?.residential ?? false;
    transact(`批量标注 ${multiFaces.length} 个房间为 ${entry.name}`, (current) => {
      const withSnapshot = ensureRoomFunctionSnapshot(current, entry);
      const updatedFaces = { ...withSnapshot.faces };
      for (const { id } of multiFaces) {
        if (updatedFaces[id]) {
          updatedFaces[id] = {
            ...updatedFaces[id],
            function_code: code,
            display_name: entry.name,
            color: entry.color,
            heated: residential,
            occupied: residential,
          };
        }
      }
      return { ...withSnapshot, faces: updatedFaces };
    });
  };

  const selectBrushFunction = (code: string) => {
    const entry = functionTypes.find((item) => item.code === code);
    if (!entry) return;
    if (!CORE_ROOM_FUNCTION_PRESETS.some((item) => item.code === code)) {
      transact('保存房间功能模板快照', (current) =>
        ensureRoomFunctionSnapshot(current, entry),
      );
    }
    setBrushCode(code);
  };

  const resetTemplateForm = () => {
    setEditingCode(null);
    setTemplateName('');
    setTemplateColor('#94a3b8');
  };

  const saveTemplate = async () => {
    if (templateBusy) return;
    setTemplateBusy(true);
    try {
      if (editingCode) {
        await templateState.updateTemplate(editingCode, templateName, templateColor);
      } else {
        await templateState.createTemplate(templateName, templateColor);
      }
      templateState.setError('');
      resetTemplateForm();
    } catch (reason) {
      templateState.setError(reason instanceof Error ? reason.message : '模板保存失败');
    } finally {
      setTemplateBusy(false);
    }
  };

  const functionName = (code: string | null, fallback = '') =>
    fallback || functionTypes.find((item) => item.code === code)?.name || code || '未标注';
  const functionColor = (code: string | null, fallback = '#e2e8f0') =>
    functionTypes.find((item) => item.code === code)?.color || fallback;

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
          <span style={{ color: functionColor(brushCode) }}>
            {functionName(brushCode)}
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
          {functionTypes.map((entry) => (
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
                  selectBrushFunction(entry.code);
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
            房间属性: {functionName(selectedFace.function_code, selectedFace.display_name)}
          </div>
          <div className={styles.properties}>
            <label className={styles.field}>
              <span>功能</span>
              <span className={styles.value}>
                {functionName(selectedFace.function_code, selectedFace.display_name)}
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

      <div className={styles.section}>
        <div className={styles.sectionTitle}>全项目自定义模板</div>
        {templateState.loading && <div className={styles.multiInfo}>正在读取模板…</div>}
        <div className={styles.templateForm}>
          <input
            aria-label="自定义模板名称"
            placeholder="例如：火炕间"
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
          />
          <input
            aria-label="自定义模板颜色"
            type="color"
            value={templateColor}
            onChange={(event) => setTemplateColor(event.target.value)}
          />
          <button type="button" disabled={templateBusy} onClick={() => void saveTemplate()}>
            {editingCode ? '保存模板' : '添加模板'}
          </button>
          {editingCode && <button type="button" onClick={resetTemplateForm}>取消</button>}
        </div>
        <div className={styles.templateList}>
          {templateState.templates.map((template) => (
            <div key={template.code} className={styles.templateItem}>
              <span className={styles.colorDot} style={{ background: template.color }} />
              <span>{template.name}</span>
              <button type="button" aria-label={`编辑模板 ${template.name}`} onClick={() => {
                setEditingCode(template.code);
                setTemplateName(template.name);
                setTemplateColor(template.color);
              }}>编辑</button>
              <button type="button" aria-label={`删除模板 ${template.name}`} onClick={async () => {
                if (!confirm(`删除全项目模板“${template.name}”？已有建筑标注会继续保留。`)) return;
                try {
                  await templateState.deleteTemplate(template.code);
                  if (editingCode === template.code) resetTemplateForm();
                } catch (reason) {
                  templateState.setError(reason instanceof Error ? reason.message : '模板删除失败');
                }
              }}>删除</button>
            </div>
          ))}
        </div>
        {templateState.error && <div className={styles.templateError}>{templateState.error}</div>}
      </div>

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
