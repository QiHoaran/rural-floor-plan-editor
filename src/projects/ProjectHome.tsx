// ============================================================
// 项目首页 — v2.1.0 丰富卡片展示
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  listProjects,
  listTrashedProjects,
  trashProject,
  restoreProject,
  downloadProjectArchive,
  type ProjectSummary,
} from '@/api/projectApi.ts';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import { NewProjectDialog } from './NewProjectDialog.tsx';
import { BulkSurveyImportDialog } from './BulkSurveyImportDialog.tsx';
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
              }`}
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
                {/* 名称 + 状态 + 日期 */}
                <div className={styles.cardTop}>
                  <strong>{project.building_id}</strong>
                  <span className={styles.cardName}>{project.name}</span>
                  <span
                    className={`${styles.statusBadge} ${styles[project.status]}`}
                  >
                    {STATUS_LABELS[project.status] ?? project.status}
                  </span>
                  <time>
                    {new Date(project.updated_at).toLocaleDateString()}
                  </time>
                </div>

                {/* 统计 + 数据质量 */}
                <div className={styles.cardStats}>
                  <div className={styles.statItem}>
                    <span>房间</span>
                    <b>{project.room_count}</b>
                  </div>
                  <div className={styles.statItem}>
                    <span>面积</span>
                    <b>{(project.total_floor_area_m2 ?? 0).toFixed(1)} m²</b>
                  </div>
                  <div className={styles.statItem}>
                    <span>标注</span>
                    <b>{project.room_semantic_progress}%</b>
                  </div>
                  <div className={styles.issueSummary}>
                    {project.validation_error_count > 0 && (
                      <span className={styles.errorCount}>
                        ✕ {project.validation_error_count} 错误
                      </span>
                    )}
                    {project.validation_warning_count > 0 && (
                      <span className={styles.warningCount}>
                        ⚠ {project.validation_warning_count} 警告
                      </span>
                    )}
                    {project.validation_error_count === 0 &&
                      project.validation_warning_count === 0 && (
                        <span className={styles.cleanBadge}>✓ 无问题</span>
                      )}
                  </div>
                </div>

                {/* 进度条（一行横排） */}
                <div className={styles.progressBars}>
                  <div className={styles.progressItem}>
                    <span className={styles.progressLabel}>几何</span>
                    <div className={styles.progressTrack}>
                      <div
                        className={styles.progressFill}
                        style={{
                          width: `${project.geometry_progress}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className={styles.progressItem}>
                    <span className={styles.progressLabel}>语义</span>
                    <div className={styles.progressTrack}>
                      <div
                        className={styles.progressFill}
                        style={{
                          width: `${project.room_semantic_progress}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className={styles.progressItem}>
                    <span className={styles.progressLabel}>门窗</span>
                    <div className={styles.progressTrack}>
                      <div
                        className={styles.progressFill}
                        style={{
                          width: `${project.opening_progress}%`,
                        }}
                      />
                    </div>
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
