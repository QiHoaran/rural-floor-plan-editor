import { useState } from 'react';
import { useServerAutoSave } from '@/editor/hooks/useServerAutoSave.ts';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import { Toolbar } from '@/editor/toolbar/Toolbar.tsx';
import { SvgCanvas } from '@/editor/canvas/SvgCanvas.tsx';
import { EditablePropertyPanel } from '@/editor/panels/EditablePropertyPanel.tsx';
import {
  exportProjectUrl,
  type ExportUrlOptions,
} from '@/api/projectApi.ts';
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

  const [exportScale, setExportScale] = useState('1:200');
  const [exportScaleBar, setExportScaleBar] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);

  useServerAutoSave({
    buildingId: buildingDocument?.building_id ?? null,
    document: buildingDocument,
    changeVersion,
    onSaving: beginSave,
    onSaved: finishSave,
    onError: (error) =>
      failSave(error instanceof Error ? error.message : '自动保存失败'),
  });

  if (!buildingDocument) {
    return <div className={styles.loading}>未加载建筑文档</div>;
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        {onBack && (
          <button
            onClick={onBack}
            className={styles.headerBtnSecondary}
          >
            返回
          </button>
        )}
        <span className={styles.title}>乡村住宅 CAD 矢量编辑器</span>
        <span className={styles.projectId}>
          {buildingDocument.building_id}
        </span>
        <div className={styles.headerActions}>
          <div className={styles.exportGroup}>
            <a
              className={styles.headerBtnSecondary}
              href={exportProjectUrl(buildingDocument.building_id, {
                scale: exportScale,
                scaleBar: exportScaleBar,
              })}
              download
              aria-label="导出建筑包"
              title="导出 ZIP（含 PNG 平面图）"
            >
              ⤓ 导出
            </a>
            <button
              className={styles.headerBtnSecondary}
              onClick={() => setShowExportOptions((v) => !v)}
              aria-label="导出选项"
              title="PNG 导出设置"
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
          </span>
          {saveError && (
            <span className={styles.saveError} title={saveError}>
              {saveError}
            </span>
          )}
        </div>
      </header>

      <div className={styles.body}>
        <Toolbar />
        <div className={styles.mapArea}>
          <SvgCanvas />
        </div>
        <EditablePropertyPanel />
      </div>
    </div>
  );
}
