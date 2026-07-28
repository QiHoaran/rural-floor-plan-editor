// ============================================================
// 右侧属性面板
// ============================================================

import { usePlanStore } from '@/editor/store/planStore.ts';
import { wallLengthCm, wallAngleDeg } from '@/editor/domain/wallGeometry.ts';
import styles from './PropertyPanel.module.css';

export function PropertyPanel() {
  const selectedEntityId = usePlanStore((s) => s.selectedEntityId);
  const selectedEntityType = usePlanStore((s) => s.selectedEntityType);
  const planDocument = usePlanStore((s) => s.planDocument);

  // 无选中实体
  if (!selectedEntityId || selectedEntityType === 'none') {
    return (
      <aside className={styles.panel}>
        <div className={styles.header}>属性</div>
        <div className={styles.empty}>
          <p>选择墙体、门窗或房间</p>
          <p className={styles.hint}>查看和编辑属性</p>
        </div>
      </aside>
    );
  }

  // 墙属性
  if (selectedEntityType === 'wall') {
    const wall = planDocument.walls[selectedEntityId];
    if (!wall) return null;

    const startV = planDocument.vertices[wall.start_vertex_id];
    const endV = planDocument.vertices[wall.end_vertex_id];
    const length = startV && endV ? wallLengthCm(startV, endV) : null;
    const angle = startV && endV ? wallAngleDeg(startV, endV) : null;

    return (
      <aside className={styles.panel}>
        <div className={styles.header}>墙体属性</div>
        <div className={styles.content}>
          <Field label="ID" value={selectedEntityId} mono />
          <Field label="类型" value={wall.wall_type} />
          <Field label="长度" value={length ? `${length} cm` : '-'} />
          <Field label="角度" value={angle !== null ? `${angle.toFixed(1)}°` : '-'} />
          <Field label="厚度" value={`${wall.thickness_cm} cm`} />
          <Field label="高度" value={`${wall.height_cm} cm`} />
          <Field label="材料" value={wall.material_type} />
          <Field label="审核" value={wall.review_status} />
          <Field label="起点" value={wall.start_vertex_id} mono />
          <Field label="终点" value={wall.end_vertex_id} mono />
          {wall.notes && <Field label="备注" value={wall.notes} />}
        </div>
      </aside>
    );
  }

  // 门窗属性
  if (selectedEntityType === 'opening') {
    const opening = planDocument.openings[selectedEntityId];
    if (!opening) return null;

    return (
      <aside className={styles.panel}>
        <div className={styles.header}>
          {opening.opening_type === 'door' ? '门' : '窗'}属性
        </div>
        <div className={styles.content}>
          <Field label="ID" value={selectedEntityId} mono />
          <Field label="类型" value={opening.opening_type} />
          <Field label="宿主墙" value={opening.host_wall_id} mono />
          <Field label="偏移" value={`${opening.offset_from_start_cm} cm`} />
          <Field label="宽度" value={`${opening.width_cm} cm`} />
          <Field label="高度" value={`${opening.height_cm} cm`} />
          {opening.opening_type === 'window' && (
            <Field label="窗台高度" value={`${opening.sill_height_cm} cm`} />
          )}
          <Field label="审核" value={opening.review_status} />
          {opening.notes && <Field label="备注" value={opening.notes} />}
        </div>
      </aside>
    );
  }

  // 空间/房间属性
  if (selectedEntityType === 'space') {
    const space = planDocument.spaces[selectedEntityId];
    if (!space) return null;

    // 计算面积
    let area = '-';
    if (space.generated_polygon && space.generated_polygon.length > 0) {
      const verts = space.generated_polygon[0];
      if (verts.length >= 3) {
        let a = 0;
        for (let i = 0; i < verts.length; i++) {
          const j = (i + 1) % verts.length;
          a += verts[i][0] * verts[j][1];
          a -= verts[j][0] * verts[i][1];
        }
        area = `${(Math.abs(a) / 2 / 10000).toFixed(2)} m²`;
      }
    }

    return (
      <aside className={styles.panel}>
        <div className={styles.header}>房间属性</div>
        <div className={styles.content}>
          <Field label="编号" value={selectedEntityId} mono />
          <Field label="类型" value={space.room_type} />
          {space.local_name && <Field label="地方名称" value={space.local_name} />}
          <Field label="面积" value={area} />
          <Field label="采暖" value={space.heated ? '是' : '否'} />
          <Field label="置信度" value={space.confidence} />
          <Field label="来源" value={space.source} />
          <Field label="审核" value={space.review_status} />
          {space.notes && <Field label="备注" value={space.notes} />}
        </div>
      </aside>
    );
  }

  return null;
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={`${styles.fieldValue} ${mono ? styles.mono : ''}`}>{value}</span>
    </div>
  );
}
