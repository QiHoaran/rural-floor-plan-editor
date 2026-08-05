// ============================================================
// 状态栏 — 显示工具、坐标、比例、选中数、统计、保存状态
// v2.1.0
// ============================================================

import { useMemo } from 'react';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import { countUnlabeledFaces } from '@/editor/domain/buildingStatistics.ts';
import { REFERENCE_DIRECTION_LABEL } from '@/editor/domain/constants.ts';
import styles from './StatusBar.module.css';

const TOOL_LABELS: Record<string, string> = {
  select: '选择',
  exterior_wall: '外墙',
  interior_wall: '内墙',
  polyline_wall: '多段线',
  exterior_door: '外门',
  exterior_window: '外窗',
  interior_door: '内门',
  passage: '无门洞',
  adjust_reference: '参考图',
  room_label_brush: '房间标注刷',
  reference_calibration: '比例标定',
};

export function StatusBar() {
  const document = useEditorStore((state) => state.buildingDocument);
  const tool = useEditorStore((state) => state.tool);
  const selection = useEditorStore((state) => state.selection);
  const saveStatus = useEditorStore((state) => state.buildingSaveStatus);

  const stats = useMemo(() => {
    if (!document) return null;
    const stats = document.statistics;
    const unlabeled = countUnlabeledFaces(document);
    return {
      roomCount: stats?.room_count ?? 0,
      floorArea: stats?.total_floor_area_m2 ?? 0,
      wallCount: Object.keys(document.walls).length,
      vertexCount: Object.keys(document.vertices).length,
      unlabeled,
      errors: stats?.validation_error_count ?? 0,
      warnings: stats?.validation_warning_count ?? 0,
      revision: document.metadata?.revision ?? 0,
    };
  }, [document]);

  const calibrationStatus = useMemo(() => {
    if (!document) return '未标定';
    if (document.reference_calibration?.calibrated) return '已标定';
    return '未标定';
  }, [document]);

  const multiSelection = useEditorStore((state) => state.multiSelection);
  const selectionCount = multiSelection.length > 1
    ? multiSelection.length
    : selection ? 1 : 0;

  const saveLabel = (() => {
    switch (saveStatus) {
      case 'saved': return '✓ 已保存';
      case 'saving': return '⟳ 保存中';
      case 'unsaved': return '● 未保存';
      case 'error': return '✗ 失败';
      case 'conflict': return '⚠ 冲突';
    }
  })();

  if (!document) return null;

  return (
    <footer className={styles.statusbar}>
      <div className={styles.left}>
        <span className={styles.item}>
          工具: {TOOL_LABELS[tool] ?? tool}
        </span>
        <span className={styles.sep} />
        <span className={styles.item}>比例: {calibrationStatus}</span>
        <span className={styles.item}>方向: {REFERENCE_DIRECTION_LABEL}</span>
        <span className={styles.sep} />
        {stats && (
          <>
            <span className={styles.item}>墙: {stats.wallCount}</span>
            <span className={styles.item}>房间: {stats.roomCount}</span>
            <span className={styles.item}>
              面积: {stats.floorArea.toFixed(1)} m²
            </span>
            <span className={styles.item}>
              未标注: <span className={stats.unlabeled > 0 ? styles.warning : ''}>
                {stats.unlabeled}
              </span>
            </span>
            <span className={styles.item}>顶点: {stats.vertexCount}</span>
          </>
        )}
      </div>

      <div className={styles.right}>
        <span className={styles.item}>选中: {selectionCount}</span>
        {stats && (
          <>
            <span className={styles.sep} />
            <span className={`${styles.item} ${stats.errors > 0 ? styles.error : ''}`}>
              ✕ {stats.errors} 错误
            </span>
            <span className={`${styles.item} ${stats.warnings > 0 ? styles.warning : ''}`}>
              ⚠ {stats.warnings} 警告
            </span>
          </>
        )}
        <span className={styles.sep} />
        <span className={`${styles.item} ${styles[saveStatus] ?? ''}`}>
          {saveLabel}
        </span>
        <span className={styles.item}>
          v{stats?.revision ?? 0}
        </span>
      </div>
    </footer>
  );
}
