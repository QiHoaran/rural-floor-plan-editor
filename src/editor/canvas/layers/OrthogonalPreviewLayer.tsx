import { Fragment } from 'react';
import { useEditorStore } from '../../store/editorStore.ts';
import { useOrthogonalPreviewStore } from '../../store/orthogonalPreviewStore.ts';
import type { BuildingDocument } from '../../domain/buildingTypes.ts';

export function OrthogonalPreviewLayer() {
  const document = useEditorStore(s => s.buildingDocument);
  const preview = useOrthogonalPreviewStore(s => s.preview);
  if (!preview || document !== preview.source || document.workflow.status === 'complete') return null;
  const after = preview.result.document;
  const ids = new Set([...Object.keys(document.walls), ...Object.keys(after.walls)]);
  const segment = (doc: BuildingDocument, id: string) => {
    const wall = doc.walls[id];
    if (!wall) return null;
    const a = doc.vertices[wall.start_vertex_id], b = doc.vertices[wall.end_vertex_id];
    return a && b ? [a.x_mm, a.y_mm, b.x_mm, b.y_mm] : null;
  };
  return <g pointerEvents="none" aria-label="正交修复画布预览">
    {[...ids].map(id => {
      const old = segment(document, id), next = segment(after, id);
      if (JSON.stringify(old) === JSON.stringify(next)) return null;
      return <Fragment key={id}>
        {old && <line data-testid={`orthogonal-preview-before-${id}`} x1={old[0]} y1={old[1]} x2={old[2]} y2={old[3]} stroke="#d97706" strokeWidth={4} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
        {next && <line data-testid={`orthogonal-preview-after-${id}`} x1={next[0]} y1={next[1]} x2={next[2]} y2={next[3]} stroke="#16a34a" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
      </Fragment>;
    })}
  </g>;
}
