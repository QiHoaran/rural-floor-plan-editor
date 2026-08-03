// ============================================================
// 编辑器布局 — v2.1.0
// 整合工具栏、画布、属性面板、数据质量面板、状态栏
// ============================================================

import { useState, useEffect } from 'react';
import { useServerAutoSave } from '@/editor/hooks/useServerAutoSave.ts';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import { Toolbar } from '@/editor/toolbar/Toolbar.tsx';
import { SvgCanvas } from '@/editor/canvas/SvgCanvas.tsx';
import { EditablePropertyPanel } from '@/editor/panels/EditablePropertyPanel.tsx';
import { DataQualityPanel } from '@/editor/panels/DataQualityPanel.tsx';
import { RoomLabelPanel } from '@/editor/panels/RoomLabelPanel.tsx';
import { StatusBar } from '@/editor/panels/StatusBar.tsx';
import {
  exportProject,
  submitReview,
  reviewProject,
  completeProject,
  reopenProject,
  ApiError,
} from '@/api/projectApi.ts';
import { getNextUnlabeledFaceId } from '@/editor/domain/buildingStatistics.ts';
import { ROOM_SHORTCUT_MAP } from '@/editor/domain/constants.ts';
import styles from './EditorLayout.module.css';

interface EditorLayoutProps {
  onBack?: () => void;
}

export function EditorLayout({ onBack }: EditorLayoutProps) {
  const buildingDocument = useEditorStore(
    (state) => state.buildingDocument,
  );
  const changeVersion = useEditorStore((state) => state.changeVersion);
  const saveStatus = useEditorStore(
    (state) => state.buildingSaveStatus,
  );
  const saveError = useEditorStore((state) => state.buildingSaveError);
  const beginSave = useEditorStore((state) => state.beginBuildingSave);
  const finishSave = useEditorStore((state) => state.finishBuildingSave);
  const failSave = useEditorStore((state) => state.failBuildingSave);
  const conflictSave = useEditorStore((state) => state.conflictSave);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const setBrushCode = useEditorStore((state) => state.setBrushFunctionCode);
  const setSelection = useEditorStore((state) => state.setSelection);

  const [exportScale, setExportScale] = useState('1:200');
  const [exportScaleBar, setExportScaleBar] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [rightPanel, setRightPanel] = useState<'property' | 'quality' | 'label'>('property');
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [deliveryBusy, setDeliveryBusy] = useState(false);

  useServerAutoSave({
    buildingId: buildingDocument?.building_id ?? null,
    document: buildingDocument,
    changeVersion,
    onSaving: beginSave,
    onSaved: finishSave,
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'REVISION_CONFLICT') {
        conflictSave(error.message);
      } else {
        failSave(error instanceof Error ? error.message : '自动保存失败');
      }
    },
    onConflict: () => {
      conflictSave('版本冲突：请重新加载项目');
    },
  });

  // 全局快捷键：房间标注和未标注跳转
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      ) {
        return;
      }

      // 快捷键只在非输入框时生效
      const doc = useEditorStore.getState().buildingDocument;
      if (!doc) return;

      // 房间标注刷快捷键（数字键 1-9, 0）
      if (
        tool === 'room_label_brush' &&
        ROOM_SHORTCUT_MAP[event.key]
      ) {
        event.preventDefault();
        setBrushCode(ROOM_SHORTCUT_MAP[event.key]);
        return;
      }

      // 未标注房间跳转
      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const sel = useEditorStore.getState().selection;
        if (event.shiftKey) {
          // 上一个未标注
          jumpToPrev(doc);
        } else {
          const nextId = getNextUnlabeledFaceId(
            doc,
            sel?.type === 'face' ? sel.id : undefined,
          );
          if (nextId) {
            setSelection({ type: 'face', id: nextId });
          }
        }
        return;
      }

      // Ctrl+Z / Ctrl+Y
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }

      // Esc: 退出标注刷
      if (event.key === 'Escape' && tool === 'room_label_brush') {
        setTool('select');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tool, undo, redo, setTool, setBrushCode, setSelection]);

  if (!buildingDocument) {
    return <div className={styles.loading}>未加载建筑文档</div>;
  }

  const workflowStatus =
    buildingDocument.workflow?.status ??
    buildingDocument.metadata?.status ??
    'draft';

  const handleSubmitReview = async () => {
    if (deliveryBusy) return;
    setDeliveryBusy(true);
    try {
      const current = useEditorStore.getState().buildingDocument;
      if (!current) return;
      const doc = await submitReview(current.building_id, current);
      useEditorStore.getState().loadBuilding(doc);
      setWorkflowError(null);
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : '提交审核失败');
    } finally {
      setDeliveryBusy(false);
    }
  };

  const handleReview = async () => {
    if (deliveryBusy) return;
    setDeliveryBusy(true);
    try {
      const current = useEditorStore.getState().buildingDocument;
      if (!current) return;
      const doc = await reviewProject(current.building_id, current);
      useEditorStore.getState().loadBuilding(doc);
      setWorkflowError(null);
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : '审核操作失败');
    } finally {
      setDeliveryBusy(false);
    }
  };

  const handleComplete = async () => {
    if (deliveryBusy) return;
    if (
      !confirm(
        '确认完成此项目？完成后项目将变为只读，需要重新打开才能编辑。',
      )
    ) {
      return;
    }
    setDeliveryBusy(true);
    try {
      const current = useEditorStore.getState().buildingDocument;
      if (!current) return;
      const doc = await completeProject(current.building_id, current);
      useEditorStore.getState().loadBuilding(doc);
      setWorkflowError(null);
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : '无法完成项目');
    } finally {
      setDeliveryBusy(false);
    }
  };

  const handleReopen = async () => {
    if (!confirm('重新打开后可以继续编辑，确认吗？')) return;
    try {
      const doc = await reopenProject(buildingDocument.building_id);
      useEditorStore.getState().loadBuilding(doc);
      setWorkflowError(null);
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : '重新打开失败');
    }
  };

  const handleExport = async () => {
    if (deliveryBusy) return;
    const current = useEditorStore.getState().buildingDocument;
    if (!current) return;
    setDeliveryBusy(true);
    beginSave();
    try {
      const result = await exportProject(current.building_id, current, {
        scale: exportScale,
        scaleBar: exportScaleBar,
      });
      finishSave(result.document);
      downloadBlob(result.blob, `${current.building_id}.zip`);
      setWorkflowError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '导出失败';
      failSave(message);
      setWorkflowError(message);
    } finally {
      setDeliveryBusy(false);
    }
  };

  const isReadOnly = workflowStatus === 'complete';

  return (
    <div className={styles.container}>
      {/* 顶部工具栏 */}
      <header className={styles.header}>
        {onBack && (
          <button
            onClick={onBack}
            className={styles.headerBtnSecondary}
          >
            ← 返回
          </button>
        )}
        <span className={styles.title}>乡村住宅 CAD 矢量编辑器</span>
        <span className={styles.projectId}>
          {buildingDocument.building_id}
        </span>

        {/* 工作流按钮 */}
        <div className={styles.workflowGroup}>
          {workflowStatus === 'draft' && (
            <button
              className={styles.headerBtnSecondary}
              onClick={handleSubmitReview}
              disabled={isReadOnly || deliveryBusy}
            >
              📋 提交审核
            </button>
          )}
          {workflowStatus === 'pending_review' && (
            <>
              <button
                className={styles.headerBtnSecondary}
                onClick={() => handleReview()}
                disabled={deliveryBusy}
              >
                ✅ 审核通过
              </button>
            </>
          )}
          {workflowStatus === 'reviewed' && (
            <button
              className={styles.headerBtn}
              onClick={handleComplete}
              disabled={deliveryBusy}
            >
              🔒 完成项目
            </button>
          )}
          {workflowStatus === 'complete' && (
            <button
              className={styles.headerBtnSecondary}
              onClick={handleReopen}
              disabled={deliveryBusy}
            >
              🔓 重新打开
            </button>
          )}
        </div>

        <div className={styles.headerActions}>
          {/* 撤销/重做 */}
          <button
            className={styles.headerBtnSecondary}
            onClick={undo}
            title="撤销 (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            className={styles.headerBtnSecondary}
            onClick={redo}
            title="重做 (Ctrl+Y)"
          >
            ↪
          </button>

          {/* 导出 */}
          <div className={styles.exportGroup}>
            <button
              className={styles.headerBtnSecondary}
              onClick={handleExport}
              disabled={deliveryBusy}
              aria-label="导出建筑包"
              title="导出完整研究数据包"
            >
              {deliveryBusy ? '导出中…' : '⤓ 导出'}
            </button>
            <button
              className={styles.headerBtnSecondary}
              onClick={() => setShowExportOptions((v) => !v)}
              aria-label="导出选项"
            >
              ⚙
            </button>
          </div>
          {showExportOptions && (
            <div className={styles.exportOptions}>
              <label className={styles.exportOption}>
                <span>比例</span>
                <select
                  value={exportScale}
                  onChange={(e) => setExportScale(e.target.value)}
                >
                  <option value="1:500">1:500</option>
                  <option value="1:200">1:200</option>
                  <option value="1:100">1:100</option>
                  <option value="1:50">1:50</option>
                </select>
              </label>
              <label className={styles.exportOption}>
                <input
                  type="checkbox"
                  checked={exportScaleBar}
                  onChange={(e) => setExportScaleBar(e.target.checked)}
                />
                <span>包含比例尺</span>
              </label>
            </div>
          )}

          <span className={`${styles.saveStatus} ${styles[saveStatus]}`}>
            {saveStatus === 'saved' && '✓ 已自动保存'}
            {saveStatus === 'unsaved' && '● 等待保存'}
            {saveStatus === 'saving' && '⟳ 保存中'}
            {saveStatus === 'error' && '✗ 保存失败'}
            {saveStatus === 'conflict' && '⚠ 版本冲突'}
          </span>
          {saveError && (
            <span className={styles.saveError} title={saveError}>
              {saveError}
            </span>
          )}
        </div>
      </header>

      {workflowError && (
        <div className={styles.workflowError}>
          {workflowError}
          <button onClick={() => setWorkflowError(null)}>✕</button>
        </div>
      )}

      {/* 主体区域 */}
      <div className={styles.body}>
        <Toolbar />
        <div className={styles.mapArea}>
          <SvgCanvas />
        </div>

        {/* 右侧面板切换 */}
        <div className={styles.rightPanel}>
          <div className={styles.panelTabs}>
            <button
              className={rightPanel === 'property' ? styles.activeTab : styles.tab}
              onClick={() => setRightPanel('property')}
            >
              属性
            </button>
            <button
              className={rightPanel === 'label' ? styles.activeTab : styles.tab}
              onClick={() => setRightPanel('label')}
            >
              房间
            </button>
            <button
              className={rightPanel === 'quality' ? styles.activeTab : styles.tab}
              onClick={() => setRightPanel('quality')}
            >
              质量
            </button>
          </div>
          <div className={styles.panelContent}>
            {rightPanel === 'property' && <EditablePropertyPanel />}
            {rightPanel === 'label' && <RoomLabelPanel />}
            {rightPanel === 'quality' && <DataQualityPanel />}
          </div>
        </div>
      </div>

      {/* 底部状态栏 */}
      <StatusBar />
    </div>
  );
}

/**
 * 跳转到上一个未标注房间
 */
function jumpToPrev(doc: NonNullable<ReturnType<typeof useEditorStore.getState>['buildingDocument']>) {
  const faceIds = Object.keys(doc.faces);
  if (faceIds.length === 0) return;
  const sel = useEditorStore.getState().selection;
  const currentIndex = sel?.type === 'face'
    ? faceIds.indexOf(sel.id)
    : faceIds.length;
  const startIndex = currentIndex > 0 ? currentIndex - 1 : faceIds.length - 1;

  for (let i = startIndex; i >= 0; i--) {
    const face = doc.faces[faceIds[i]];
    if (!face.function_code || face.function_code === 'unknown') {
      useEditorStore.getState().setSelection({ type: 'face', id: faceIds[i] });
      return;
    }
  }
  for (let i = faceIds.length - 1; i > startIndex; i--) {
    const face = doc.faces[faceIds[i]];
    if (!face.function_code || face.function_code === 'unknown') {
      useEditorStore.getState().setSelection({ type: 'face', id: faceIds[i] });
      return;
    }
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
