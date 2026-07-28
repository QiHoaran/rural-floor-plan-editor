// ============================================================
// 底部状态栏
// ============================================================

import { usePlanStore } from '@/editor/store/planStore.ts';
import styles from './StatusBar.module.css';

export function StatusBar() {
  const activeTool = usePlanStore((s) => s.activeTool);
  const snapMode = usePlanStore((s) => s.snapMode);
  const currentWallThickness = usePlanStore((s) => s.currentWallThickness);
  const validationIssues = usePlanStore((s) => s.validationIssues);
  const planDocument = usePlanStore((s) => s.planDocument);

  const errors = validationIssues.filter((i) => i.level === 'error').length;
  const warnings = validationIssues.filter((i) => i.level === 'warning').length;

  const snapLabels: Record<string, string> = {
    major: '24 cm',
    minor: '6 cm',
    fine: '1 cm',
    none: '吸附关',
  };

  const toolLabels: Record<string, string> = {
    select: '选择',
    exterior_wall: '外墙',
    interior_wall: '内墙',
    continuous_wall: '连续墙',
    rectangle_room: '矩形房间',
    door: '门',
    window: '窗',
    calibrate: '比例标定',
    parallel_copy: '平行复制',
    delete: '删除',
    none: '无',
  };

  return (
    <footer className={styles.statusbar}>
      <span className={styles.item}>
        工具: {toolLabels[activeTool] || activeTool}
      </span>
      <span className={styles.sep} />
      <span className={styles.item}>
        吸附: {snapLabels[snapMode]}
      </span>
      <span className={styles.sep} />
      <span className={styles.item}>
        墙厚: {currentWallThickness} cm
      </span>
      <span className={styles.sep} />
      <span className={styles.item}>
        墙: {Object.keys(planDocument.walls).length}
      </span>
      <span className={styles.sep} />
      <span className={styles.item}>
        房间: {Object.keys(planDocument.spaces).length}
      </span>
      <span className={styles.sep} />
      <span className={styles.item}>
        顶点: {Object.keys(planDocument.vertices).length}
      </span>

      <div className={styles.right}>
        {errors > 0 && (
          <span className={`${styles.item} ${styles.error}`}>
            ✗ {errors} 错误
          </span>
        )}
        {warnings > 0 && (
          <span className={`${styles.item} ${styles.warning}`}>
            ⚠ {warnings} 警告
          </span>
        )}
        <span className={styles.item}>
          v{planDocument.schema_version}
        </span>
        <span className={styles.item}>
          修订 #{planDocument.metadata.revision}
        </span>
      </div>
    </footer>
  );
}
