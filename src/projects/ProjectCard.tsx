// ============================================================
// 建筑项目卡片 — 从 ProjectHome 抽出并 memo 化
// 465 张卡片同屏渲染，勾选/搜索/拖拽时必须避免整列表重渲染，
// 因此所有回调都必须是稳定引用，选中态以 boolean 传入而非 Set。
// ============================================================

import { memo, useState, type DragEvent } from 'react';
import { projectPreviewUrl, type ProjectSummary } from '@/api/projectApi.ts';
import { STATUS_LABELS, formatProjectDate } from './projectFormat.ts';
import styles from './ProjectHome.module.css';

export interface CardDropState {
  status: 'hover' | 'busy' | 'success' | 'error';
  message: string;
}

interface ProjectCardProps {
  project: ProjectSummary;
  selected: boolean;
  highlighted: boolean;
  disabled: boolean;
  /** 仅该卡片的拖拽提示（导入中/成功/失败），未命中的卡片传 null。 */
  drop: CardDropState | null;
  onToggle: (buildingId: string) => void;
  onOpen: (buildingId: string) => void;
  onDetails: (buildingId: string) => void;
  onConvert: (project: ProjectSummary) => void;
  onDelete: (buildingId: string) => void;
  onDropFile: (event: DragEvent<HTMLDivElement>, project: ProjectSummary) => void;
}

export const ProjectCard = memo(function ProjectCard({
  project, selected, highlighted, disabled, drop,
  onToggle, onOpen, onDetails, onConvert, onDelete, onDropFile,
}: ProjectCardProps) {
  // 拖拽悬停是纯卡片本地状态：不能上抛到父级，否则一张卡片 hover 会重渲染全部 465 张。
  const [hovering, setHovering] = useState(false);
  const overlay = drop ?? (hovering
    ? { status: 'hover' as const, message: project.has_reference_image ? '已有参考图，不能覆盖' : '松开以导入参考图' }
    : null);

  return (
    <div
      data-building-id={project.building_id}
      data-check-status={project.check?.status ?? 'unchecked'}
      className={`${styles.projectCard} ${project.check?.status === 'error' ? styles.checkError : ''} ${highlighted ? styles.highlight : ''} ${
        selected ? styles.projectCardSelected : ''
      } ${overlay?.status === 'hover' ? styles.projectCardDropActive : ''}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setHovering(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = project.has_reference_image ? 'none' : 'copy';
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) setHovering(false);
      }}
      onDrop={(event) => { setHovering(false); void onDropFile(event, project); }}
    >
      <label className={styles.projectSelector}>
        <input
          type="checkbox"
          aria-label={`选择 ${project.building_id}`}
          disabled={disabled}
          checked={selected}
          onChange={() => onToggle(project.building_id)}
        />
      </label>
      <button
        className={styles.projectCardMain}
        disabled={disabled}
        onClick={() => onOpen(project.building_id)}
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
      <button className={styles.detailButton} aria-label={`详情 ${project.building_id}`} onClick={() => onDetails(project.building_id)}>详情</button>
      <button className={styles.conversionButton} aria-label={`数据转换 ${project.building_id}`} title={project.status === 'complete' ? '数据转换' : '仅已完成项目可以转换'} disabled={disabled || project.status !== 'complete'} onClick={() => onConvert(project)}>数据转换</button>
      <button
        disabled={disabled}
        className={styles.deleteBtn}
        aria-label={`删除 ${project.building_id}`}
        title="移入回收站"
        onClick={() => onDelete(project.building_id)}
      >
        🗑
      </button>
      {overlay && (
        <div className={`${styles.dropOverlay} ${styles[overlay.status]}`}>
          {overlay.message}
        </div>
      )}
    </div>
  );
});
