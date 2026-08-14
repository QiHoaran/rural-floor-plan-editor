import { useEffect, useState, type FormEvent } from 'react';
import type { BuildingTemplateInput } from '@/editor/domain/buildingTemplate.ts';
import styles from './BuildingTemplateDialog.module.css';

interface Props {
  open: boolean;
  error: string;
  initialInput: BuildingTemplateInput;
  onClose: () => void;
  onApply: (input: BuildingTemplateInput) => void;
}

export function BuildingTemplateDialog({ open, error, initialInput, onClose, onApply }: Props) {
  const [frontage, setFrontage] = useState('10');
  const [depth, setDepth] = useState('4.5');
  const [roomCount, setRoomCount] = useState('4');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFrontage(String(initialInput.frontageMm / 1000));
    setDepth(String(initialInput.depthMm / 1000));
    setRoomCount(String(initialInput.roomCount));
    setLocalError('');
  }, [open, initialInput.frontageMm, initialInput.depthMm, initialInput.roomCount]);

  if (!open) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const frontageMm = metersToMm(frontage);
    const depthMm = metersToMm(depth);
    const rooms = Number(roomCount);
    if (frontageMm < 100 || depthMm < 100) {
      setLocalError('正房开间和正房面宽必须至少为 0.1 米。');
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
        <p>根据正房尺寸生成矩形外墙，并按房间数等分内部空间。</p>
        <label>
          <span>正房开间（米）</span>
          <input aria-label="模板正房开间（米）" value={frontage} onChange={(event) => setFrontage(event.target.value)} />
        </label>
        <label>
          <span>正房面宽（米）</span>
          <input aria-label="模板正房面宽（米）" value={depth} onChange={(event) => setDepth(event.target.value)} />
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
