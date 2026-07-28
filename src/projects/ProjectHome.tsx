import { useCallback, useEffect, useState } from 'react';
import {
  listProjects,
  listTrashedProjects,
  trashProject,
  restoreProject,
  type ProjectSummary,
} from '@/api/projectApi.ts';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import { NewProjectDialog } from './NewProjectDialog.tsx';
import styles from './ProjectHome.module.css';

interface ProjectHomeProps {
  onOpen: (buildingId: string, document?: BuildingDocument) => void;
}

export function ProjectHome({ onOpen }: ProjectHomeProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [trashed, setTrashed] = useState<ProjectSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = useCallback(() => {
    let active = true;
    setState('loading');
    Promise.all([listProjects(), listTrashedProjects()])
      .then(([activeItems, trashedItems]) => {
        if (!active) return;
        setProjects(activeItems);
        setTrashed(trashedItems);
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

  return (
    <main className={styles.home}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>RURAL BUILDING DATA</p>
          <h1>乡村住宅矢量编辑器</h1>
          <p>根据参考草图绘制精确结构，并输出独立建筑包。</p>
        </div>
        <button
          className={styles.primaryButton}
          onClick={() => setDialogOpen(true)}
        >
          新建建筑
        </button>
      </section>

      <section className={styles.projects}>
        <h2>建筑项目</h2>
        {state === 'loading' && <p>正在读取 data 目录…</p>}
        {state === 'error' && <p className={styles.error}>无法读取建筑项目</p>}
        {state === 'ready' && projects.length === 0 && (
          <div className={styles.empty}>尚无建筑，创建第一栋建筑。</div>
        )}
        <div className={styles.projectGrid}>
          {projects.map((project) => (
            <div key={project.building_id} className={styles.projectCard}>
              <button
                className={styles.projectCardMain}
                onClick={() => onOpen(project.building_id)}
              >
                <strong>{project.building_id}</strong>
                <span>
                  {project.status === 'complete' ? '已完成' : '草稿'}
                </span>
                <time>{new Date(project.updated_at).toLocaleString()}</time>
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
                  <strong>{project.building_id}</strong>
                  <span className={styles.trashedLabel}>已删除</span>
                  <time>
                    {new Date(project.updated_at).toLocaleString()}
                  </time>
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
    </main>
  );
}
