import { useEffect, useMemo, useState } from 'react';
import type { BuildingDocument } from '../domain/buildingTypes.ts';
import { previewOrthogonalRepair, type AlignmentAxis, type FixedEnd } from '../commands/orthogonalRepair.ts';
import { validateBuildingDocumentFull } from '../domain/buildingValidation.ts';
import { isOrthogonalIssue, ORTHOGONAL_NOTICE } from '../domain/orthogonalValidation.ts';
import { useEditorStore } from '../store/editorStore.ts';
import { useOrthogonalPreviewStore } from '../store/orthogonalPreviewStore.ts';
import styles from './DataQualityPanel.module.css';

export function OrthogonalRepairPanel({ source, wallId, onClose }: {
  source: BuildingDocument; wallId: string; onClose: () => void;
}) {
  const document = useEditorStore(s => s.buildingDocument);
  const [fixedEnd, setFixedEnd] = useState<FixedEnd>('start');
  const [axis, setAxis] = useState<AlignmentAxis | undefined>();
  const result = useMemo(() => previewOrthogonalRepair(source, wallId, fixedEnd, axis), [source, wallId, fixedEnd, axis]);
  const stale = document !== source;
  const readonly = document?.workflow.status === 'complete';
  const before = useMemo(() => validateBuildingDocumentFull(source), [source]);
  const after = useMemo(() => result.ok ? validateBuildingDocumentFull(result.document) : [], [result]);
  useEffect(() => {
    const store = useOrthogonalPreviewStore.getState();
    store.setPreview(!stale && !readonly && result.ok ? { source, result } : null);
    if (!stale && !readonly && result.ok) {
      const ids = new Set(result.affectedWallIds.flatMap(id => [source.walls[id].start_vertex_id, source.walls[id].end_vertex_id]));
      store.focus({ source, points: [...ids].flatMap(id => [source.vertices[id], result.document.vertices[id]]).filter(Boolean).concat(result.target) });
    }
    return () => store.setPreview(null);
  }, [source, result, stale, readonly]);
  const apply = () => {
    const store = useEditorStore.getState();
    if (!result.ok || store.buildingDocument !== source || source.workflow.status === 'complete') return;
    store.transact(`正交修复 ${wallId}`, current => current === source ? { ...result.document, structured_validation: after } : current);
    onClose();
  };
  const count = (issues: typeof before, kind: 'axis' | 'error' | 'warning') => issues.filter(i => kind === 'axis' ? isOrthogonalIssue(i.code) : i.severity === kind).length;
  return <section className={styles.repairPanel} aria-label="正交修复预览">
    <strong>正交修复 · {wallId}</strong>
    <p>{ORTHOGONAL_NOTICE}</p>
    <label>固定端点<select aria-label="固定端点" disabled={stale || readonly} value={fixedEnd} onChange={e => setFixedEnd(e.target.value as FixedEnd)}>
      <option value="start">起点</option><option value="end">终点</option>
    </select></label>
    <label>对齐方向<select aria-label="对齐方向" disabled={stale || readonly} value={axis ?? (result.ok ? result.axis : 'horizontal')} onChange={e => setAxis(e.target.value as AlignmentAxis)}>
      <option value="horizontal">水平</option><option value="vertical">垂直</option>
    </select></label>
    {stale ? <p role="alert">文档已变化，预览已失效。请取消后重新预览。</p> : !result.ok ? <p role="alert">{result.message}</p> : <>
      <p>移动 {result.distanceMm.toLocaleString('zh-CN', { maximumFractionDigits: 3 })} mm；关联墙：{result.affectedWallIds.join('、')}</p>
      <p>橙色虚线：原位置；绿色实线：修复后位置</p>
      <p>非正交 {count(before, 'axis')} → {count(after, 'axis')}；错误 {count(before, 'error')} → {count(after, 'error')}；警告 {count(before, 'warning')} → {count(after, 'warning')}</p>
      <p>正交通过仅表示满足该项要求，不代表满足全部转换条件。</p>
    </>}
    <div className={styles.repairActions}>
      <button onClick={apply} disabled={stale || readonly || !result.ok}>应用修复</button>
      <button onClick={onClose}>取消修复</button>
    </div>
  </section>;
}
