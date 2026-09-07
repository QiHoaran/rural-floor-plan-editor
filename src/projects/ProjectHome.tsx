// ============================================================
// 项目首页 — v2.1.0 丰富卡片展示
// ============================================================

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  listProjects,
  listTrashedProjects,
  trashProject,
  restoreProject,
  downloadProjectArchive,
  projectPreviewUrl,
  type ProjectSummary,
} from '@/api/projectApi.ts';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import { NewProjectDialog } from './NewProjectDialog.tsx';
import { BulkSurveyImportDialog } from './BulkSurveyImportDialog.tsx';
import { ConversionDialog } from './ConversionDialog.tsx';
import { hasSavedConversion } from './conversionStorage.ts';
import { uploadReferenceImageFile } from './imageFile.ts';
import { useProjectIndex, readIndexState } from './useProjectIndex.ts';
import styles from './ProjectHome.module.css';

interface ProjectHomeProps {
  onOpen: (buildingId: string, document?: BuildingDocument) => void;
}

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending_review: '待审核',
  reviewed: '已审核',
  complete: '已完成',
};

export function ProjectHome({ onOpen }: ProjectHomeProps) {
  const requestGeneration = useRef(0);
  const [projects, setProjects] = useState<ProjectSummary[]>(() => readIndexState().projects ?? []);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const [trashed, setTrashed] = useState<ProjectSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() =>
    readIndexState().projects?.length ? 'ready' : 'loading',
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [conversionProjects, setConversionProjects] = useState<ProjectSummary[] | null>(() => hasSavedConversion() ? [] : null);
  const [importMessage, setImportMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(readIndexState().selected ?? []));
  const [legacyBatchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');
  const index = useProjectIndex(projects, setProjects, selectedIds, setSelectedIds, setBatchMessage);
  const batchBusy = legacyBatchBusy || index.busy;
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashError, setTrashError] = useState('');
  const [openError, setOpenError] = useState('');
  const [opening, setOpening] = useState(false);
  const openBuilding = async (id: string, document?: BuildingDocument) => {
    if (opening || batchBusy) return;
    index.remember(id); setOpening(true); setOpenError('');
    try { if (document) await onOpen(id, document); else await onOpen(id); }
    catch (error) { setOpenError(error instanceof Error ? error.message : '无法打开建筑'); }
    finally { setOpening(false); }
  };
  useEffect(() => {
    if (!trashOpen) return;
    let active = true;
    setTrashError('');
    listTrashedProjects().then(items => { if (active) setTrashed(items); }).catch(() => { if (active) setTrashError('无法读取回收站'); });
    return () => { active = false; };
  }, [trashOpen, projects]);
  const [dropState, setDropState] = useState<{
    buildingId: string;
    status: 'hover' | 'busy' | 'success' | 'error';
    message: string;
  } | null>(null);

  const refresh = useCallback(() => {
    let active = true;
    const generation = ++requestGeneration.current;
    const baseline = new Map(projectsRef.current.map(p => [p.building_id, p]));
    listProjects()
      .then((activeItems) => {
        if (!active || generation !== requestGeneration.current) return;
        setProjects(current => activeItems.map(item => {
          const local = current.find(p => p.building_id === item.building_id);
          // A concurrent check may finish after this list request took its snapshot.
          if (local && local !== baseline.get(item.building_id) && local.revision >= item.revision) return local;
          return item;
        }));

        const activeIds = new Set(activeItems.map((item) => item.building_id));
        setSelectedIds((current) =>
          new Set([...current].filter((id) => activeIds.has(id))),
        );
        setState('ready');
      })
      .catch(() => {
        if (active && generation === requestGeneration.current) setState('error');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  const handleDelete = async (buildingId: string) => {
    if (!confirm(`确定删除建筑「${buildingId}」？可稍后从回收站恢复。`)) return;
    try {
      await trashProject(buildingId);
      setProjects(current => current.filter(p => p.building_id !== buildingId));
      refresh();
    } catch (err) {
      alert(
        err instanceof Error ? err.message : '删除失败',
      );
    }
  };

  const handleRestore = async (buildingId: string) => {
    try {
      const document = await restoreProject(buildingId);
      refresh();
      void openBuilding(buildingId, document);
    } catch (err) {
      alert(
        err instanceof Error ? err.message : '恢复失败',
      );
    }
  };

  const toggleSelected = (buildingId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(buildingId)) next.delete(buildingId);
      else next.add(buildingId);
      return next;
    });
  };

  const handleBatchDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || batchBusy) return;
    if (!confirm(`确定将选中的 ${ids.length} 栋建筑移入回收站？`)) return;
    setBatchBusy(true);
    setBatchMessage('');
    const results = await Promise.allSettled(ids.map((id) => trashProject(id)));
    const failed = ids.filter((_, index) => results[index].status === 'rejected');
    setSelectedIds(new Set(failed));
    setBatchMessage(
      failed.length === 0
        ? `已将 ${ids.length} 栋建筑移入回收站。`
        : `已删除 ${ids.length - failed.length} 栋，${failed.length} 栋失败：${failed.join('、')}`,
    );
    refresh();
    setBatchBusy(false);
  };

  const handleBatchExport = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || batchBusy) return;
    setBatchBusy(true);
    setBatchMessage('');
    const failed: string[] = [];
    for (const id of ids) {
      try {
        const blob = await downloadProjectArchive(id, {
          scale: '1:200',
          scaleBar: false,
        });
        downloadBlob(blob, `${id}.zip`);
      } catch {
        failed.push(id);
      }
    }
    setBatchMessage(
      failed.length === 0
        ? `已导出 ${ids.length} 栋建筑。`
        : `已导出 ${ids.length - failed.length} 栋，${failed.length} 栋失败：${failed.join('、')}`,
    );
    setBatchBusy(false);
  };

  const handleCardDrop = async (
    event: DragEvent<HTMLDivElement>,
    project: ProjectSummary,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (batchBusy || dropState?.status === 'busy') return;
    if (project.has_reference_image) {
      setDropState({
        buildingId: project.building_id,
        status: 'error',
        message: '已有参考图，不能覆盖',
      });
      window.setTimeout(() => setDropState((current) =>
        current?.buildingId === project.building_id ? null : current), 1800);
      return;
    }
    const files = [...event.dataTransfer.files];
    if (files.length !== 1) {
      setDropState({
        buildingId: project.building_id,
        status: 'error',
        message: '请一次拖入一张图片',
      });
      window.setTimeout(() => setDropState((current) =>
        current?.buildingId === project.building_id ? null : current), 1800);
      return;
    }
    setDropState({
      buildingId: project.building_id,
      status: 'busy',
      message: '正在导入参考图…',
    });
    try {
      await uploadReferenceImageFile(project.building_id, files[0]);
      setDropState({
        buildingId: project.building_id,
        status: 'success',
        message: '参考图已导入',
      });
      window.setTimeout(() => setDropState((current) =>
        current?.buildingId === project.building_id ? null : current), 1800);
      refresh();
    } catch (error) {
      setDropState({
        buildingId: project.building_id,
        status: 'error',
        message: error instanceof Error ? error.message : '参考图导入失败',
      });
      window.setTimeout(() => setDropState((current) =>
        current?.buildingId === project.building_id ? null : current), 2400);
    }
  };

  return (
    <main ref={index.homeRef} className={styles.home} onScroll={() => index.remember()}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>RURAL BUILDING DATA</p>
          <h1>乡村住宅矢量编辑器</h1>
          <p>
            根据参考草图绘制精确墙体结构，标注房间功能，检查数据质量，输出可用于建筑规律分析、湿热模拟和生成式平面设计的标准化数据。
          </p>
        </div>
        <div className={styles.heroActions}>
          <button className={styles.secondaryButton} disabled={batchBusy} onClick={() => setImportDialogOpen(true)}>批量导入属性</button>
          <button className={styles.primaryButton} disabled={batchBusy} onClick={() => setDialogOpen(true)}>新建建筑</button>
        </div>
      </section>

      {(importMessage || batchMessage) && (
        <div className={styles.importMessage}>{batchMessage || importMessage}</div>
      )}

      {openError && <p role="alert" className={styles.error}>{openError}</p>}
      <section className={styles.projects}>
        <div className={styles.indexToolbar}>
          <div className={styles.viewSwitch} aria-label="显示模式">
            <button aria-pressed={index.view === 'cards'} onClick={() => index.changeView('cards')}>卡片</button>
            <button aria-pressed={index.view === 'list'} onClick={() => index.changeView('list')}>列表</button>
          </div>
          <input aria-label="搜索建筑" placeholder="搜索编号或名称" value={index.query} onChange={e => { index.setQuery(e.target.value); index.setPinned(null); }} />
          <select aria-label="工作流筛选" value={index.status} onChange={e => { index.setStatus(e.target.value); index.setPinned(null); }}>
            <option value="all">全部状态</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="检查筛选" value={index.check} onChange={e => { index.setCheck(e.target.value); index.setPinned(null); }}>
            <option value="all">全部检查结果</option><option value="unchecked">待检查</option><option value="passed">检查通过</option><option value="warning">有警告</option><option value="error">检查失败</option>
          </select>
          <select aria-label="排序" value={index.sort} onChange={e => index.setSort(e.target.value)}>
            <option value="id">编号顺序</option><option value="updated">最近更新</option><option value="issues">问题优先</option>
          </select>
          <span>{index.filtered.length} 栋</span>
          <button disabled={batchBusy} onClick={refresh}>刷新列表</button>
        </div>
        {index.retained && <p>刚编辑的建筑已不符合筛选，暂时保留，调整筛选后移除。</p>}
        {index.progress && <p role="status">{index.progress}</p>}
        {Object.keys(index.failures).length > 0 && <div className={styles.error}>
          <button onClick={index.retry} disabled={batchBusy}>选中失败项</button>
          <details><summary>查看处理失败原因</summary>{Object.entries(index.failures).map(([id, message]) => <p key={id}>{id}：{message}</p>)}</details>
        </div>}
        <div className={styles.projectHeader}>
          <h2>建筑项目</h2>
          {projects.length > 0 && (
            <div className={styles.selectionActions}>
              <span>已选 {selectedIds.size} 栋</span>
              <button disabled={batchBusy || !selectedIds.size} onClick={() => void index.batch(false)}>批量检查</button>
              <button disabled={batchBusy || !selectedIds.size} onClick={() => void index.batch(true)}>批量完成</button>
              <button disabled={batchBusy || !selectedIds.size} onClick={() => setConversionProjects(projects.filter(project => selectedIds.has(project.building_id)))}>批量转换</button>
              {hasSavedConversion() && <button onClick={() => setConversionProjects(projects.filter(project => selectedIds.has(project.building_id)))}>转换进度</button>}
              <button
                type="button"
                onClick={() => setSelectedIds(new Set([...selectedIds, ...index.filtered.map((item) => item.building_id)]))}
                disabled={batchBusy || index.filtered.every(item => selectedIds.has(item.building_id))}
              >
                全选筛选结果
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={batchBusy || selectedIds.size === 0}
              >
                清空
              </button>
              <button
                type="button"
                onClick={handleBatchExport}
                disabled={batchBusy || selectedIds.size === 0}
              >
                批量导出
              </button>
              <button
                type="button"
                className={styles.batchDeleteButton}
                onClick={handleBatchDelete}
                disabled={batchBusy || selectedIds.size === 0}
              >
                批量删除
              </button>
            </div>
          )}
        </div>
        {state === 'loading' && <p>正在读取 data 目录…</p>}
        {state === 'error' && <p className={styles.error}>无法更新建筑项目 <button onClick={refresh}>重试</button></p>}
        {state === 'ready' && projects.length === 0 && (
          <div className={styles.empty}>尚无建筑，创建第一栋建筑。</div>
        )}
        <div className={index.view === 'list' ? styles.projectList : styles.projectGrid}>
          {index.view === 'list' && <div className={styles.listHeader}><span>选择</span><span>建筑 / 状态 / 检查</span><span>房间 · 面积 · 标注 · 更新时间</span><span>操作</span></div>}
          {index.visible.map((project) => (
            <div
              key={project.building_id}
              data-building-id={project.building_id}
              data-check-status={project.check?.status ?? 'unchecked'}
              className={`${styles.projectCard} ${project.check?.status === 'error' ? styles.checkError : ''} ${index.highlight === project.building_id ? styles.highlight : ''} ${
                selectedIds.has(project.building_id) ? styles.projectCardSelected : ''
              } ${dropState?.buildingId === project.building_id ? styles.projectCardDropActive : ''}`}
              onDragEnter={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                setDropState({
                  buildingId: project.building_id,
                  status: 'hover',
                  message: project.has_reference_image
                    ? '已有参考图，不能覆盖'
                    : '松开以导入参考图',
                });
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = project.has_reference_image ? 'none' : 'copy';
              }}
              onDragLeave={(event) => {
                const next = event.relatedTarget as Node | null;
                if (!next || !event.currentTarget.contains(next)) {
                  if (dropState?.status === 'hover') setDropState(null);
                }
              }}
              onDrop={(event) => void handleCardDrop(event, project)}
            >
              <label className={styles.projectSelector}>
                <input
                  type="checkbox"
                  aria-label={`选择 ${project.building_id}`}
                  disabled={batchBusy}
                  checked={selectedIds.has(project.building_id)}
                  onChange={() => toggleSelected(project.building_id)}
                />
              </label>
              <button
                className={styles.projectCardMain}
                disabled={batchBusy || opening}
                onClick={() => void openBuilding(project.building_id)}
              >
                <div className={styles.cardThumbnail} aria-hidden="true">
                  {project.preview_kind !== 'empty' && (
                    <img
                      src={projectPreviewUrl(project.building_id, project.revision)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </div>
                <div className={styles.cardInfo}>
                  <div className={styles.cardInfoRow}>
                    <strong title={project.name}>{project.building_id}</strong>
                    <span className={`${styles.statusBadge} ${styles[project.status]}`}>
                      {STATUS_LABELS[project.status] ?? project.status}
                    </span>
                  </div>
                  <span className={styles.cardName}>{project.name !== project.building_id ? project.name : ''}</span>
                  <span className={project.check?.status === 'error' ? styles.errorCount : project.check?.status === 'warning' ? styles.warningCount : styles.checkLabel}>
                    {{ unchecked: '待重新检查', passed: '检查通过', warning: '检查有警告', error: '检查失败' }[project.check?.status ?? 'unchecked']}
                  </span>
                  <div className={styles.cardInfoRow}>
                    <time>{formatProjectDate(project.updated_at)}</time>
                    <span>参考图[{project.has_reference_image ? '✓' : ' '}]</span>
                  </div>
                  <div className={`${styles.cardInfoRow} ${styles.cardMetrics}`}>
                    <span>房间{project.room_count}</span>
                    <span>面积{(project.total_floor_area_m2 ?? 0).toFixed(1)}m²</span>
                    <span>标注{project.room_semantic_progress}%</span>
                  </div>
                </div>
              </button>
              <button className={styles.detailButton} aria-label={`详情 ${project.building_id}`} onClick={() => index.setDetails(project.building_id)}>详情</button>
              <button className={styles.conversionButton} aria-label={`数据转换 ${project.building_id}`} title={project.status === 'complete' ? '数据转换' : '仅已完成项目可以转换'} disabled={batchBusy || project.status !== 'complete'} onClick={() => setConversionProjects([project])}>数据转换</button>
              <button
                disabled={batchBusy}
                className={styles.deleteBtn}
                aria-label={`删除 ${project.building_id}`}
                title="移入回收站"
                onClick={() => handleDelete(project.building_id)}
              >
                🗑
              </button>
              {dropState?.buildingId === project.building_id && (
                <div className={`${styles.dropOverlay} ${styles[dropState.status]}`}>
                  {dropState.message}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <details className={styles.projects} onToggle={e => setTrashOpen(e.currentTarget.open)}>
        <summary>回收站</summary>
        {trashError && <p role="alert">{trashError}</p>}
      {trashOpen && (
        <section className={styles.projects}>
          <h2>回收站</h2>
          <div className={styles.projectGrid}>
            {trashed.map((project) => (
              <div key={project.building_id} className={styles.projectCard}>
                <div className={styles.projectCardMain}>
                  <div className={styles.cardTop}>
                    <strong>{project.building_id}</strong>
                    <span className={styles.trashedLabel}>已删除</span>
                    <time>
                      {new Date(project.updated_at).toLocaleString()}
                    </time>
                  </div>
                </div>
                <button
                  className={styles.restoreBtn}
                  aria-label={`恢复 ${project.building_id}`}
                  title="从回收站恢复"
                  onClick={() => handleRestore(project.building_id)}
                >
                  ↩
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      </details>
      {conversionProjects !== null && <ConversionDialog projects={conversionProjects.map(project => projects.find(current => current.building_id === project.building_id) ?? project)} onClose={() => setConversionProjects(null)} />}
      {index.details && (() => {
        const project = projects.find(p => p.building_id === index.details);
        if (!project) return null;
        return <div className={styles.dialogBackdrop} onClick={() => index.setDetails(null)}>
          <section className={`${styles.dialog} ${styles.wideDialog}`} role="dialog" aria-modal="true" aria-label="建筑检查详情" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') index.setDetails(null); }}>
            <h2>{project.building_id} · {project.name}</h2>
            <p>房间 {project.room_count ?? 0} · 面积 {(project.total_floor_area_m2 ?? 0).toFixed(1)}m² · 标注 {project.room_semantic_progress ?? 0}%</p>
            <p>更新于 {formatProjectDate(project.updated_at)} · {project.check?.checked_at ? `检查于 ${new Date(project.check.checked_at).toLocaleString()}` : '尚未检查当前版本'}</p>
            {project.check?.issues.map((issue, i) => <p key={i} className={issue.severity === 'error' ? styles.errorCount : styles.warningCount}>{issue.severity === 'error' ? '错误' : issue.severity === 'warning' ? '警告' : '信息'}：{issue.message}</p>)}
            {project.check?.status === 'passed' && <p>检查通过</p>}
            <button autoFocus onClick={() => index.setDetails(null)}>关闭</button>
          </section>
        </div>;
      })()}
      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={openBuilding}
      />
      <BulkSurveyImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImported={(result) => {
          setImportMessage(`导入完成：新建 ${result.created.length} 户，更新 ${result.updated.length} 户。`);
          refresh();
        }}
      />
    </main>
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatProjectDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
