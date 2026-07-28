// ============================================================
// 比例标定对话框
// ============================================================

import { useState, useCallback } from 'react';
import { usePlanStore } from '@/editor/store/planStore.ts';
import styles from './CalibrationDialog.module.css';

interface CalibrationDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CalibrationDialog({ open, onClose }: CalibrationDialogProps) {
  const planDocument = usePlanStore((s) => s.planDocument);
  const setPlanDocument = usePlanStore((s) => s.setPlanDocument);

  const [pixelLength, setPixelLength] = useState('100');
  const [realLengthCm, setRealLengthCm] = useState('360');
  const [result, setResult] = useState<number | null>(null);

  const calculate = useCallback(() => {
    const px = parseFloat(pixelLength);
    const cm = parseFloat(realLengthCm);
    if (px <= 0 || cm <= 0) return;

    const mPerPx = (cm / 100) / px;
    setResult(mPerPx);
  }, [pixelLength, realLengthCm]);

  const applyCalibration = useCallback(() => {
    if (result === null) return;

    setPlanDocument({
      ...planDocument,
      coordinate_system: {
        ...planDocument.coordinate_system,
        meters_per_pixel: result,
      },
    });
    onClose();
  }, [result, planDocument, setPlanDocument, onClose]);

  if (!open) return null;

  const currentMPerPx = planDocument.coordinate_system.meters_per_pixel;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>比例标定</h3>

        {currentMPerPx && (
          <div className={styles.currentInfo}>
            当前标定: {currentMPerPx.toFixed(6)} m/像素
          </div>
        )}

        <div className={styles.stepContent}>
          <p className={styles.instruction}>
            在图片上能找到两点的实际距离，请填写：
          </p>

          <div className={styles.inputRow}>
            <label>像素距离:</label>
            <input
              type="number"
              value={pixelLength}
              onChange={(e) => setPixelLength(e.target.value)}
              className={styles.input}
              min={1}
              step={1}
            />
            <span className={styles.unit}>px</span>
          </div>

          <div className={styles.inputRow}>
            <label>实际距离:</label>
            <input
              type="number"
              value={realLengthCm}
              onChange={(e) => setRealLengthCm(e.target.value)}
              className={styles.input}
              min={1}
              step={1}
            />
            <span className={styles.unit}>cm</span>
          </div>

          <button
            className={styles.btn}
            onClick={calculate}
            disabled={!pixelLength || !realLengthCm || parseFloat(pixelLength) <= 0}
          >
            计算
          </button>

          {result !== null && (
            <div className={styles.resultDisplay}>
              <div className={styles.resultItem}>
                <span>标定值:</span>
                <strong>{result.toFixed(6)} m/像素</strong>
              </div>
              <div className={styles.resultItem}>
                <span>即:</span>
                <strong>{(result * 100).toFixed(4)} cm/像素</strong>
              </div>
              <button className={styles.btn} onClick={applyCalibration}>
                应用标定
              </button>
            </div>
          )}
        </div>

        <button className={styles.closeBtn} onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
