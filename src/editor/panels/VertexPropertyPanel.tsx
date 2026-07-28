import { useState } from 'react';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import { parseCoordinateMeters } from '@/editor/domain/cadInput.ts';
import { moveVertex, deleteVertex } from '@/editor/commands/pointMoveCommand.ts';
import styles from './EditablePropertyPanel.module.css';

export function VertexPropertyPanel({ vertexId }: { vertexId: string }) {
  const document = useEditorStore((state) => state.buildingDocument)!;
  const transact = useEditorStore((state) => state.transact);
  const setSelection = useEditorStore((state) => state.setSelection);
  const vertex = document.vertices[vertexId];

  const [x, setX] = useState(
    vertex ? (vertex.x_mm / 1000).toFixed(3) : '0.000',
  );
  const [y, setY] = useState(
    vertex ? (vertex.y_mm / 1000).toFixed(3) : '0.000',
  );
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!vertex) return null;

  const connected = Object.values(document.walls).some(
    (wall) =>
      wall.start_vertex_id === vertexId ||
      wall.end_vertex_id === vertexId,
  );

  const commitCoordinate = () => {
    setError('');
    setSuccess('');
    const parsedX = parseCoordinateMeters(x);
    if (!parsedX.ok) {
      setError(`X: ${parsedX.message}`);
      return;
    }
    const parsedY = parseCoordinateMeters(y);
    if (!parsedY.ok) {
      setError(`Y: ${parsedY.message}`);
      return;
    }
    const target = {
      x_mm: parsedX.millimeters,
      y_mm: parsedY.millimeters,
    };
    if (
      target.x_mm === vertex.x_mm &&
      target.y_mm === vertex.y_mm
    ) {
      return;
    }
    const result = moveVertex(document, vertexId, target);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    transact(`移动顶点 ${vertexId}`, () => result.document);
    setX(parsedX.normalized);
    setY(parsedY.normalized);
    setSuccess('已更新');
    setSelection({ type: 'vertex', id: result.vertexId });
    setTimeout(() => setSuccess(''), 1500);
  };

  const handleDelete = () => {
    if (!confirm(`确定删除孤立顶点 ${vertexId}？`)) return;
    const result = deleteVertex(document, vertexId);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    transact(`删除顶点 ${vertexId}`, () => result.document);
    setSelection(null);
  };

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>顶点属性</div>
      <div className={styles.content}>
        <div className={styles.readOnly}>{vertexId}</div>
        <label className={styles.field}>
          <span>X 坐标（米）</span>
          <input
            aria-label="顶点 X 坐标（米）"
            inputMode="decimal"
            value={x}
            onChange={(event) => setX(event.target.value)}
            onBlur={commitCoordinate}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitCoordinate();
            }}
          />
        </label>
        <label className={styles.field}>
          <span>Y 坐标（米）</span>
          <input
            aria-label="顶点 Y 坐标（米）"
            inputMode="decimal"
            value={y}
            onChange={(event) => setY(event.target.value)}
            onBlur={commitCoordinate}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitCoordinate();
            }}
          />
        </label>
        <div className={styles.readOnly}>
          {connected ? '该顶点连接着墙体' : '孤立顶点（未连接任何墙体）'}
        </div>
        {!connected && (
          <button
            className={styles.dangerBtn}
            onClick={handleDelete}
            aria-label="删除孤立顶点"
          >
            删除顶点
          </button>
        )}
        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </aside>
  );
}
