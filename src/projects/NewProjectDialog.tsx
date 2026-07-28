import { useState, type FormEvent } from 'react';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import { createProject } from '@/api/projectApi.ts';
import { readImageFile } from './imageFile.ts';
import styles from './ProjectHome.module.css';

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (buildingId: string, document: BuildingDocument) => void;
}

export function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: NewProjectDialogProps) {
  const [buildingId, setBuildingId] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [wallThickness, setWallThickness] = useState('0.240');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const id = buildingId.trim();
    if (!id) {
      setError('请输入建筑 ID');
      return;
    }
    if (!imageFile) {
      setError('请选择参考草图');
      return;
    }

    const thicknessMeters = Number(wallThickness.trim().replace(',', '.'));
    if (
      !Number.isFinite(thicknessMeters) ||
      thicknessMeters < 0.01 ||
      thicknessMeters > 9.999
    ) {
      setError('墙厚必须在 0.01–9.999 米范围内');
      return;
    }
    const thicknessMm = Math.round(thicknessMeters * 1000);
    if (thicknessMm <= 0) {
      setError('墙厚必须大于 0');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const image = await readImageFile(imageFile);
      const document = await createProject({
        building_id: id,
        ...image,
        wall_thickness_mm: thicknessMm,
      });
      onCreated(id, document);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : '创建建筑失败',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <form
        className={styles.dialog}
        aria-label="新建建筑"
        onSubmit={handleSubmit}
      >
        <h2>新建建筑</h2>
        <label>
          <span>建筑 ID</span>
          <input
            aria-label="建筑 ID"
            value={buildingId}
            onChange={(event) => setBuildingId(event.target.value)}
            placeholder="house_0001"
            autoFocus
          />
        </label>
        <label>
          <span>参考草图</span>
          <input
            aria-label="参考草图"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) =>
              setImageFile(event.target.files?.[0] ?? null)
            }
          />
        </label>
        <label>
          <span>默认墙厚（米）</span>
          <input
            aria-label="默认墙厚（米）"
            inputMode="decimal"
            value={wallThickness}
            onChange={(event) => setWallThickness(event.target.value)}
            placeholder="0.240"
          />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.dialogActions}>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={submitting}
          >
            {submitting ? '创建中…' : '创建建筑'}
          </button>
        </div>
      </form>
    </div>
  );
}
