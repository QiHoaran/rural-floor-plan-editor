// ============================================================
// 左侧工具栏 — v2.1.0 扩展
// ============================================================

import {
  useEditorStore,
  type EditorTool,
} from '@/editor/store/editorStore.ts';
import styles from './Toolbar.module.css';

interface ToolDef {
  type: EditorTool;
  label: string;
  icon: string;
  shortcut?: string;
  group?: string;
}

const TOOLS: ToolDef[] = [
  // 选择和导航
  { type: 'select', label: '选择', icon: '↖', shortcut: 'V', group: 'nav' },

  // 墙体绘制
  { type: 'exterior_wall', label: '外墙', icon: '▤', shortcut: 'W1', group: 'draw' },
  { type: 'interior_wall', label: '内墙', icon: '▥', shortcut: 'W2', group: 'draw' },
  { type: 'polyline_wall', label: '多段线', icon: '━', shortcut: 'W3', group: 'draw' },

  // 门窗构件
  { type: 'exterior_door', label: '外门', icon: 'D', group: 'element' },
  { type: 'exterior_window', label: '外窗', icon: 'W', group: 'element' },
  { type: 'interior_door', label: '内门', icon: 'd', group: 'element' },
  { type: 'passage', label: '无门洞', icon: 'P', group: 'element' },

  // v2.1.0: 标注与标定
  { type: 'room_label_brush', label: '房间标注刷', icon: '🖌', shortcut: 'L', group: 'label' },
  { type: 'reference_calibration', label: '比例标定', icon: '📏', shortcut: 'C', group: 'calib' },
  { type: 'north_orientation', label: '设置北向', icon: '🧭', shortcut: 'N', group: 'calib' },

  // 参考图
  { type: 'adjust_reference', label: '调整参考图', icon: '▧', shortcut: 'R', group: 'ref' },
];

const GROUP_LABELS: Record<string, string> = {
  nav: '导航',
  draw: '绘图',
  element: '构件',
  label: '标注',
  calib: '标定',
  ref: '参考',
};

export function Toolbar() {
  const activeTool = useEditorStore((state) => state.tool);
  const setActiveTool = useEditorStore((state) => state.setTool);

  // Group tools
  const groups = new Map<string, ToolDef[]>();
  for (const tool of TOOLS) {
    const group = tool.group ?? 'other';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(tool);
  }

  return (
    <aside
      className={styles.toolbar}
      role="toolbar"
      aria-label="绘图工具"
    >
      {Array.from(groups.entries()).map(([group, tools]) => (
        <div key={group} className={styles.toolGroup}>
          <div className={styles.groupLabel}>
            {GROUP_LABELS[group] ?? group}
          </div>
          {tools.map((tool) => (
            <button
              key={tool.type}
              className={`${styles.toolBtn} ${activeTool === tool.type ? styles.active : ''}`}
              onClick={() => setActiveTool(tool.type)}
              aria-pressed={activeTool === tool.type}
              aria-label={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
              title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
            >
              <span className={styles.toolIcon}>{tool.icon}</span>
              <span className={styles.toolLabel}>{tool.label}</span>
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
