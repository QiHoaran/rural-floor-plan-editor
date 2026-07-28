// ============================================================
// 键盘快捷键 Hook
// ============================================================

import { useEffect } from 'react';
import { usePlanStore } from '@/editor/store/planStore.ts';
import { NUM_KEY_WALL_THICKNESS } from '@/editor/domain/constants.ts';
import type { ToolType } from '@/editor/domain/planTypes.ts';

/**
 * 工具快捷键映射
 */
const TOOL_SHORTCUTS: Record<string, ToolType> = {
  KeyV: 'select',
  Digit1: 'exterior_wall',
  Digit2: 'interior_wall',
  Digit3: 'continuous_wall',
  Digit4: 'rectangle_room',
  KeyD: 'door',
  KeyW: 'window',
  KeyC: 'calibrate',
  KeyP: 'parallel_copy',
  Delete: 'delete',
};

export function useKeyboardShortcuts() {
  const setActiveTool = usePlanStore((s) => s.setActiveTool);
  const setCurrentWallThickness = usePlanStore((s) => s.setCurrentWallThickness);
  const setSnapMode = usePlanStore((s) => s.setSnapMode);
  const activeTool = usePlanStore((s) => s.activeTool);
  const selectedEntityId = usePlanStore((s) => s.selectedEntityId);
  const selectedEntityType = usePlanStore((s) => s.selectedEntityType);
  const removeWall = usePlanStore((s) => s.removeWall);
  const removeOpening = usePlanStore((s) => s.removeOpening);
  const setSelectedEntity = usePlanStore((s) => s.setSelectedEntity);
  const pushUndo = usePlanStore((s) => s.pushUndo);
  const undo = usePlanStore((s) => s.undo);
  const redo = usePlanStore((s) => s.redo);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框或文本框中，不处理快捷键
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        // 除了Esc清除选中外，其他快捷键不生效
        if (e.code !== 'Escape') return;
      }

      // 撤销 Ctrl+Z / Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // 重做 Ctrl+Shift+Z / Cmd+Shift+Z 或 Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        redo();
        return;
      }

      // Esc：取消选中/选择工具
      if (e.code === 'Escape') {
        setSelectedEntity(null, 'none');
        setActiveTool('select');
        return;
      }

      // Delete/Backspace：删除选中的实体
      if ((e.code === 'Delete' || e.code === 'Backspace') && selectedEntityId) {
        e.preventDefault();
        pushUndo(`删除 ${selectedEntityType}`);
        if (selectedEntityType === 'wall') {
          removeWall(selectedEntityId);
        } else if (selectedEntityType === 'opening') {
          removeOpening(selectedEntityId);
        }
        setSelectedEntity(null, 'none');
        return;
      }

      // 工具切换 (不按Ctrl/Meta/Alt的情况下)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // 数字键 1-5：切换墙厚（只在非输入状态下）
        if (e.code in NUM_KEY_WALL_THICKNESS) {
          e.preventDefault();
          setCurrentWallThickness(NUM_KEY_WALL_THICKNESS[e.code]);
          return;
        }

        // 工具快捷键
        if (e.code in TOOL_SHORTCUTS) {
          e.preventDefault();
          setActiveTool(TOOL_SHORTCUTS[e.code]);
          return;
        }
      }

      // Snap mode switching: Shift+M → major, Shift+N → minor, Shift+F → fine
      if (e.shiftKey && e.code === 'KeyM') {
        e.preventDefault();
        setSnapMode('major');
        return;
      }
      if (e.shiftKey && e.code === 'KeyN') {
        e.preventDefault();
        setSnapMode('minor');
        return;
      }
      if (e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        setSnapMode('fine');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTool,
    selectedEntityId,
    selectedEntityType,
    setActiveTool,
    setCurrentWallThickness,
    setSnapMode,
    removeWall,
    removeOpening,
    setSelectedEntity,
    pushUndo,
    undo,
    redo,
  ]);
}
