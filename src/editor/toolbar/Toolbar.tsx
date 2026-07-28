// ============================================================
// 左侧工具栏
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
}

const TOOLS: ToolDef[] = [
  { type: 'select', label: '选择', icon: '↖', shortcut: 'V' },
  { type: 'exterior_wall', label: '外墙', icon: '▤', shortcut: '1' },
  { type: 'interior_wall', label: '内墙', icon: '▥', shortcut: '2' },
  { type: 'polyline_wall', label: '多段线', icon: '━', shortcut: '3' },
  {
    type: 'adjust_reference',
    label: '调整参考图',
    icon: '▧',
    shortcut: 'R',
  },
  { type: 'exterior_door', label: '外门', icon: 'D' },
  { type: 'exterior_window', label: '外窗', icon: 'W' },
  { type: 'interior_door', label: '内门', icon: 'd' },
  { type: 'passage', label: '无门洞', icon: 'P' },
];

export function Toolbar() {
  const activeTool = useEditorStore((state) => state.tool);
  const setActiveTool = useEditorStore((state) => state.setTool);

  return (
    <aside
      className={styles.toolbar}
      role="toolbar"
      aria-label="绘图工具"
    >
      {TOOLS.map((tool) => (
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
    </aside>
  );
}
