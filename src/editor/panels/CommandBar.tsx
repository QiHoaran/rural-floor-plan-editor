import type { SnapResult } from '@/editor/cad/snapEngine.ts';
import type { WallCommandState } from '@/editor/commands/wallCommand.ts';
import {
  useEditorStore,
  type EditorTool,
} from '@/editor/store/editorStore.ts';
import styles from './CommandBar.module.css';

interface CommandBarProps {
  tool: EditorTool;
  command: WallCommandState;
  error: string | null;
  snap?: SnapResult;
}

const TOOL_LABELS: Record<EditorTool, string> = {
  select: '选择',
  exterior_wall: '外墙',
  interior_wall: '内墙',
  polyline_wall: '多段线',
  adjust_reference: '调整参考图',
  exterior_door: '外门',
  exterior_window: '外窗',
  interior_door: '内门',
  passage: '无门洞',
  room_label_brush: '房间标注刷',
  reference_calibration: '比例标定',
};

const SNAP_LABELS: Record<Exclude<SnapResult['kind'], 'none'>, string> = {
  vertex: '顶点',
  intersection: '交点',
  wall_projection: '墙上投影',
  wall_fraction: '墙体分点',
  grid: '网格',
};

export function CommandBar({
  tool,
  command,
  error,
  snap = { kind: 'none' },
}: CommandBarProps) {
  const directionMode = useEditorStore((state) => state.directionMode);
  const setDirectionMode = useEditorStore(
    (state) => state.setDirectionMode,
  );
  const length =
    command.phase === 'drawing'
      ? Math.hypot(
          command.previewEnd.x_mm - command.start.point.x_mm,
          command.previewEnd.y_mm - command.start.point.y_mm,
        ) / 1000
      : null;
  return (
    <div className={styles.bar}>
      <span>工具：{TOOL_LABELS[tool]}</span>
      {isWallTool(tool) && (
        <span aria-label="方向模式" className={styles.directionModes}>
          方向：
          {(
            [
              ['orthogonal', '正交'],
              ['diagonal45', '45 度'],
              ['free', '自由'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-label={label}
              aria-pressed={directionMode === mode}
              className={styles.modeButton}
              onClick={() => setDirectionMode(mode)}
            >
              {label}
            </button>
          ))}
        </span>
      )}
      {command.phase === 'drawing' && (
        <>
          <span>角度：{command.angleDeg.toFixed(1)}°</span>
          <span>预览：{length!.toFixed(2)} m</span>
          <span data-testid="command-input" className={styles.input}>
            长度：{command.input || '直接键入米数'}
          </span>
        </>
      )}
      {command.phase === 'idle' && command.continuationAnchor && (
        <span>按住 Alt 从最近终点续画</span>
      )}
      {command.phase === 'drawing' && command.mode === 'polyline' && (
        <span>多段线：提交当前段后继续，Esc 结束</span>
      )}
      {command.phase === 'drawing' &&
        command.mode === 'single' &&
        command.continuation && <span>续画已激活</span>}
      {snap.kind !== 'none' && (
        <span data-testid="snap-status" aria-live="polite">
          吸附：{SNAP_LABELS[snap.kind]}
          {snap.kind === 'wall_fraction' ? ` ${snap.fraction}` : ''} ({formatCoordinate(snap.point.x_mm)},{' '}
          {formatCoordinate(snap.point.y_mm)})
        </span>
      )}
      <span className={styles.help}>
        Enter 提交 · Esc 取消 · Space 平移
      </span>
      {error && (
        <span className={styles.error} aria-live="polite">
          {error}
        </span>
      )}
    </div>
  );
}

function isWallTool(tool: EditorTool): boolean {
  return (
    tool === 'exterior_wall' ||
    tool === 'interior_wall' ||
    tool === 'polyline_wall'
  );
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
