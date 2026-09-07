import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, type ProjectSummary } from '@/api/projectApi.ts';
import { getConversion, listConversionFormats, openConversionFolder, recoverConversion, startConversion, type ConversionFormat, type ConversionJob } from '@/api/conversionApi.ts';
import styles from './ProjectHome.module.css';
import { CONVERSION_JOB_KEY, CONVERSION_PATH_KEY, readSavedJob, readConversionPath } from './conversionStorage.ts';
const statuses = { queued: '等待中', running: '转换中', succeeded: '成功', skipped: '已跳过', quarantined: '已隔离', failed: '失败' };

export function ConversionDialog({ projects, onClose }: { projects: ProjectSummary[]; onClose: () => void }) {
  const [formats, setFormats] = useState<ConversionFormat[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [outputRoot, setOutputRoot] = useState(readConversionPath);
  const [overwrite, setOverwrite] = useState(false);
  const [job, setJob] = useState<ConversionJob | null>(null);
  const [saved] = useState(readSavedJob);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [recovering, setRecovering] = useState(!!saved);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const eligible = projects.filter(project => project.status === 'complete');
  const running = !!job && (job.status === 'queued' || job.status === 'running');
  const busy = submitting || recovering || running;
  const remember = (next: ConversionJob) => {
    try {
      if (next.items.some(item => item.status === 'succeeded')) localStorage.setItem(CONVERSION_PATH_KEY, next.outputRoot);
      localStorage.setItem(CONVERSION_JOB_KEY, JSON.stringify({ id: next.id, outputRoot: next.outputRoot }));
    } catch { /* Conversion remains usable if browser storage is unavailable. */ }
  };
  useEffect(() => {
    let active = true;
    listConversionFormats().then(result => {
      if (!active) return;
      setFormats(result.formats); setSelected(result.formats.filter(format => format.available).map(format => format.id));
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : '无法读取转换格式'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!saved) return;
    let active = true;
    getConversion(saved.id).catch(err => {
      if (err instanceof ApiError && err.status === 404) return recoverConversion(saved);
      throw err;
    }).then(next => { if (active) { setJob(next); setOutputRoot(next.outputRoot); remember(next); } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : '无法恢复转换任务'); })
      .finally(() => { if (active) setRecovering(false); });
    return () => { active = false; };
  }, [saved]);
  useEffect(() => {
    if (!running || !job) return;
    let active = true;
    const timer = window.setTimeout(() => {
      getConversion(job.id).catch(err => {
        if (err instanceof ApiError && err.status === 404) return recoverConversion({ id: job.id, outputRoot: job.outputRoot });
        throw err;
      }).then(next => { if (active) { setError(''); setJob(next); remember(next); } })
        .catch(err => { if (active) { setError(err instanceof Error ? err.message : '读取进度失败，正在重试'); setJob({ ...job }); } });
    }, 1000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [job, running]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    formRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const root = outputRoot.trim();
    if (!root || !(/^[a-z]:[\\/]/i.test(root) || root.startsWith('/') || /^\\\\[^\\]+\\[^\\]+/.test(root))) {
      setError('请输入服务器本机的绝对输出路径'); return;
    }
    if (!eligible.length || !selected.length || busy) return;
    setSubmitting(true); setError('');
    try {
      const next = await startConversion({ projects: eligible.map(project => ({ buildingId: project.building_id, revision: project.revision })), formats: selected, outputRoot: root, overwrite });
      setJob(next); remember(next);
    } catch (err) { setError(err instanceof Error ? err.message : '创建转换任务失败'); }
    finally { setSubmitting(false); }
  };
  const close = () => {
    if (job && !running) { try { localStorage.removeItem(CONVERSION_JOB_KEY); } catch { /* optional storage */ } }
    onClose();
  };
  return <div className={styles.dialogBackdrop}>
    <form ref={formRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="数据转换" className={`${styles.dialog} ${styles.wideDialog}`} onSubmit={submit}
      onKeyDown={event => {
        if (event.key === 'Escape' && !submitting) { event.preventDefault(); close(); }
        if (event.key === 'Tab') {
          const controls = Array.from(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === formRef.current)) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <h2>数据转换</h2>
      {!job && <>
        <p>已选 {projects.length} 栋，可转换 {eligible.length} 栋；跳过 {projects.length - eligible.length} 栋未完成项目。</p>
        <fieldset disabled={busy || loading} className={styles.conversionFormats}><legend>目标格式</legend>
          {loading && <p>正在检查转换环境…</p>}
          {formats.map(format => <label key={format.id} title={format.reason}>
            <input type="checkbox" checked={selected.includes(format.id)} disabled={!format.available} onChange={event => setSelected(current => event.target.checked ? [...current, format.id] : current.filter(id => id !== format.id))} />
            <span>{format.label}{!format.available && `（不可用：${format.reason ?? '环境未配置'}）`}</span>
          </label>)}
        </fieldset>
        <label>输出文件夹（服务器本机绝对路径）<input aria-label="输出文件夹" value={outputRoot} disabled={busy} onChange={event => setOutputRoot(event.target.value)} placeholder="例如 D:\\转换结果" /></label>
        <p className={styles.dialogHint}>保存为：指定文件夹 / 建筑编号 / Graph、Image、CAD、Embodied。禁止写入 data 目录。</p>
        <label className={styles.conversionCheckbox}><input type="checkbox" checked={overwrite} disabled={busy} onChange={event => setOverwrite(event.target.checked)} />覆盖已有结果</label>
        <p className={styles.dialogHint}>默认跳过已有格式目录。覆盖时仅替换本次选中的格式。</p>
      </>}
      {recovering && <p role="status">正在恢复转换任务…</p>}
      {job && <>
        <p role="status">{running ? '正在转换，可关闭弹窗，任务在后台继续。' : job.status === 'interrupted' ? '任务已中断，可重新提交。' : '转换已结束。'} 已处理 {job.items.filter(item => !['queued', 'running'].includes(item.status)).length} / {job.items.length}</p>
        <p className={styles.conversionPath}>输出文件夹：{job.outputRoot}</p>
        {job.message && <p>{job.message}</p>}
        <div className={styles.conversionResults}><table><thead><tr><th>建筑</th><th>格式</th><th>状态 / 原因</th></tr></thead><tbody>
          {job.items.map(item => <tr key={`${item.buildingId}:${item.format}`}><td>{item.buildingId}</td><td>{formats.find(format => format.id === item.format)?.label ?? item.format}</td><td>{statuses[item.status]}{item.message && `：${item.message}`}</td></tr>)}
        </tbody></table></div>
      </>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.dialogActions}>
        {job && <button type="button" onClick={() => void openConversionFolder(job.id).catch(err => setError(err instanceof Error ? err.message : '无法打开输出目录'))}>打开输出目录</button>}
        {job && !running && <button type="button" disabled={!eligible.length} onClick={() => { setJob(null); setError(''); try { localStorage.removeItem(CONVERSION_JOB_KEY); } catch { /* optional storage */ } }}>重新选择格式</button>}
        <button type="button" disabled={submitting} onClick={close}>关闭</button>
        {!job && <button className={styles.primaryButton} type="submit" disabled={busy || loading || !eligible.length || !selected.length}>{submitting ? '提交中…' : '开始转换'}</button>}
      </div>
    </form>
  </div>;
}
