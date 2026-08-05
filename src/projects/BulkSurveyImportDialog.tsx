import { useMemo, useState, type FormEvent } from 'react';
import { bulkImportSurveys, type BulkSurveyImportResult } from '@/api/projectApi.ts';
import { parseSurveyText, SURVEY_COLUMNS } from '@/editor/domain/surveyData.ts';
import styles from './ProjectHome.module.css';

const EXAMPLE = [
  SURVEY_COLUMNS.join('\t'),
  '1\t1\t1\t69\t2\t2\t4\t5\t6\t3\t2.5\t1\t5\t13\t5\t0\t0\t4',
  '1\t2\t1\t65\t2\t2\t4\t1\t4\t1\t2.5\t1\t3\t8\t5\t0\t0\t3',
].join('\n');

export function BulkSurveyImportDialog({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: (result: BulkSurveyImportResult) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const parsed = useMemo(() => text.trim() ? parseSurveyText(text) : null, [text]);
  if (!open) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const result = parseSurveyText(text);
    if (result.issues.length > 0) {
      setError(result.issues.slice(0, 3).map((issue) => `第 ${issue.row} 行：${issue.message}`).join('；'));
      return;
    }
    setSubmitting(true); setError('');
    try {
      const imported = await bulkImportSurveys(result.records);
      onImported(imported);
      setText('');
      onClose();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '批量导入失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <form className={`${styles.dialog} ${styles.wideDialog}`} aria-label="批量导入住户属性" onSubmit={handleSubmit}>
        <div>
          <h2>批量导入住户属性</h2>
          <p className={styles.dialogHint}>支持 Excel 直接粘贴的 TSV、CSV 和 JSON。每行按 rural + house 创建或更新一个项目。</p>
        </div>
        <label>
          <span>选择数据文件（.csv / .tsv / .txt / .json）</span>
          <input aria-label="选择属性数据文件" type="file" accept=".csv,.tsv,.txt,.json,application/json,text/csv,text/plain" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setText(await file.text()); setError('');
          }} />
        </label>
        <label>
          <span>或粘贴数据</span>
          <textarea aria-label="批量属性数据" rows={12} value={text} onChange={(event) => { setText(event.target.value); setError(''); }} placeholder={EXAMPLE} />
        </label>
        <div className={styles.importStatus}>
          {!parsed && '尚未读取数据'}
          {parsed && parsed.issues.length === 0 && `已识别 ${parsed.records.length} 条有效记录`}
          {parsed && parsed.issues.length > 0 && `发现 ${parsed.issues.length} 个问题，可导入 ${parsed.records.length} 条`}
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.dialogActions}>
          <button type="button" onClick={() => setText(EXAMPLE)}>载入示例</button>
          <span className={styles.actionSpacer} />
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" className={styles.primaryButton} disabled={submitting || !text.trim()}>{submitting ? '导入中…' : '开始导入'}</button>
        </div>
      </form>
    </div>
  );
}
