import { useEffect, useState, type FormEvent } from 'react';
import type { BuildingTemplateInput } from '@/editor/domain/buildingTemplate.ts';
import styles from './BuildingTemplateDialog.module.css';

interface Props {
  open: boolean;
  error: string;
  onClose: () => void;
  onApply: (input: BuildingTemplateInput) => void;
}

export function BuildingTemplateDialog({ open, error, onClose, onApply }: Props) {
  const [frontage, setFrontage] = useState('10');
  const [depth, setDepth] = useState('4.5');
  const [roomCount, setRoomCount] = useState('4');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFrontage('10');
    setDepth('4.5');
    setRoomCount('4');
    setLocalError('');
  }, [open]);

  if (!open) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const frontageMm = metersToMm(frontage);
    const depthMm = metersToMm(depth);
    const rooms = Number(roomCount);
    if (frontageMm < 100 || depthMm < 100) {
      setLocalError('面宽和深度必须至少为 0.1 米。');
      return;
    }
    if (!Number.isInteger(rooms) || rooms < 1) {
      setLocalError('房间数必须是大于 0 的整数。');
      return;
    }
    setLocalError('');
    onApply({ frontageMm, depthMm, roomCount: rooms });
  };

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="建筑草图模板"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <h2>建筑草图模板</h2>
        <p>生成矩形外墙，并沿面宽方向将内部空间等分。</p>
        <label>
          <span>面宽（米）</span>
          <input aria-label="模板面宽（米）" value={frontage} onChange={(event) => setFrontage(event.target.value)} />
        </label>
        <label>
          <span>深度（米）</span>
          <input aria-label="模板深度（米）" value={depth} onChange={(event) => setDepth(event.target.value)} />
        </label>
        <label>
          <span>房间数</span>
          <input aria-label="模板房间数" inputMode="numeric" value={roomCount} onChange={(event) => setRoomCount(event.target.value)} />
        </label>
        {(localError || error) && <div className={styles.error} role="alert">{localError || error}</div>}
        <div className={styles.actions}>
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" className={styles.primary}>应用模板</button>
        </div>
      </form>
    </div>
  );
}

function metersToMm(value: string): number {
  const meters = Number(value.trim().replace(',', '.'));
  return Number.isFinite(meters) ? Math.round(meters * 1000) : 0;
}
