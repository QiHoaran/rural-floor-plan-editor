// ============================================================
// 项目首页 — v2.1.0 丰富卡片展示
// ============================================================

import { useCallback, useEffect, useState, type DragEvent } from 'react';
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
import { uploadReferenceImageFile } from './imageFile.ts';
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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [trashed, setTrashed] = useState<ProjectSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');
  const [dropState, setDropState] = useState<{
    buildingId: string;
    status: 'hover' | 'busy' | 'success' | 'error';
    message: string;
  } | null>(null);

  const refresh = useCallback(() => {
    let active = true;
    setState('loading');
    Promise.all([listProjects(), listTrashedProjects()])
      .then(([activeItems, trashedItems]) => {
        if (!active) return;
        setProjects(activeItems);
        setTrashed(trashedItems);
        const activeIds = new Set(activeItems.map((item) => item.building_id));
        setSelectedIds((current) =>
          new Set([...current].filter((id) => activeIds.has(id))),
        );
        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
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
      onOpen(buildingId, document);
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
    if (dropState?.status === 'busy') return;
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
    <main className={styles.home}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>RURAL BUILDING DATA</p>
          <h1>乡村住宅矢量编辑器</h1>
          <p>
            根据参考草图绘制精确墙体结构，标注房间功能，检查数据质量，输出可用于建筑规律分析、湿热模拟和生成式平面设计的标准化数据。
          </p>
        </div>
        <div className={styles.heroActions}>
          <button className={styles.secondaryButton} onClick={() => setImportDialogOpen(true)}>批量导入属性</button>
          <button className={styles.primaryButton} onClick={() => setDialogOpen(true)}>新建建筑</button>
        </div>
      </section>

      {(importMessage || batchMessage) && (
        <div className={styles.importMessage}>{batchMessage || importMessage}</div>
      )}

      <section className={styles.projects}>
        <div className={styles.projectHeader}>
          <h2>建筑项目</h2>
          {projects.length > 0 && (
            <div className={styles.selectionActions}>
              <span>已选 {selectedIds.size} 栋</span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set(projects.map((item) => item.building_id)))}
                disabled={batchBusy || selectedIds.size === projects.length}
              >
                全选
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
        {state === 'error' && <p className={styles.error}>无法读取建筑项目</p>}
        {state === 'ready' && projects.length === 0 && (
          <div className={styles.empty}>尚无建筑，创建第一栋建筑。</div>
        )}
        <div className={styles.projectGrid}>
          {projects.map((project) => (
            <div
              key={project.building_id}
              className={`${styles.projectCard} ${
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
                  checked={selectedIds.has(project.building_id)}
                  onChange={() => toggleSelected(project.building_id)}
                />
              </label>
              <button
                className={styles.projectCardMain}
                onClick={() => onOpen(project.building_id)}
              >
                <div className={styles.cardThumbnail} aria-hidden="true">
                  {project.preview_kind !== 'empty' && (
                    <img src={projectPreviewUrl(project.building_id)} alt="" />
                  )}
                </div>
                <div className={styles.cardInfo}>
                  <div className={styles.cardInfoRow}>
                    <strong>{project.building_id}</strong>
                    <span className={`${styles.statusBadge} ${styles[project.status]}`}>
                      {STATUS_LABELS[project.status] ?? project.status}
                    </span>
                  </div>
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
              <button
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

      {trashed.length > 0 && (
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

      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={onOpen}
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
