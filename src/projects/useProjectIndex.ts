import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { type ProjectSummary, checkProject, ApiError } from '@/api/projectApi.ts';

const KEY = 'project-index-v1';
interface IndexState {
  projects?: ProjectSummary[];
  query?: string;
  status?: string;
  check?: string;
  sort?: string;
  selected?: string[];
  anchor?: { id: string; offset: number } | null;
  scrollTop?: number;
}
export function readIndexState(): IndexState {
  try {
    const state = JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
    const projects = JSON.parse(sessionStorage.getItem(`${KEY}-projects`) ?? '[]');
    return { ...state, projects: Array.isArray(projects) ? projects : [] };
  } catch { return {}; }
}
export function writeIndexState(value: Partial<IndexState>) {
  try {
    // Scroll events only serialize the small navigation record, never the project list.
    const { projects, ...navigation } = value;
    if (projects) sessionStorage.setItem(`${KEY}-projects`, JSON.stringify(projects));
    sessionStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(sessionStorage.getItem(KEY) ?? '{}'), ...navigation }));
  } catch { /* Storage may be disabled. */ }
}
export function useProjectIndex(projects: ProjectSummary[], setProjects: React.Dispatch<React.SetStateAction<ProjectSummary[]>>,
  selectedIds: Set<string>, setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>, setMessage: (message: string) => void) {
  const [initial] = useState(readIndexState);
  const [view, setView] = useState<'cards' | 'list'>(() => {
    try { return localStorage.getItem('project-index-view') === 'list' ? 'list' : 'cards'; } catch { return 'cards'; }
  });
  const [query, setQuery] = useState(initial.query ?? '');
  const [status, setStatus] = useState(initial.status ?? 'all');
  const [check, setCheck] = useState(initial.check ?? 'all');
  const [sort, setSort] = useState(initial.sort ?? 'id');
  const [pinned, setPinned] = useState<string | null>(initial.anchor?.id ?? null);
  const [highlight, setHighlight] = useState<string | null>(initial.anchor?.id ?? null);
  const [details, setDetails] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [failures, setFailures] = useState<Record<string, string>>({});
  const homeRef = useRef<HTMLElement>(null);
  const anchor = useRef<{ id: string; offset: number } | null>(initial.anchor ?? null);
  const restore = useRef(true);
  const running = useRef(false);
  useEffect(() => { writeIndexState({ projects }); }, [projects]);
  useEffect(() => { writeIndexState({ query, status, check, sort, selected: [...selectedIds] }); }, [query, status, check, sort, selectedIds]);
  useEffect(() => { const timer = window.setTimeout(() => setHighlight(null), 2400); return () => clearTimeout(timer); }, [highlight]);
  const matches = (p: ProjectSummary) => (`${p.building_id} ${p.name ?? ''}`.toLowerCase().includes(query.toLowerCase().trim())) && (status === 'all' || p.status === status) && (check === 'all' || (p.check?.status ?? 'unchecked') === check);
  const filtered = projects.filter(matches);
  const visible = projects.filter(p => matches(p) || p.building_id === pinned).sort((a, b) => {
    if (sort === 'updated') { const diff = (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0); if (diff) return diff; }
    if (sort === 'issues') { const diff = Number(b.check?.status === 'error') - Number(a.check?.status === 'error'); if (diff) return diff; }
    return a.building_id.localeCompare(b.building_id, 'zh-CN', { numeric: true });
  });
  const remember = (id?: string) => {
    const root = homeRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    const items = [...root.querySelectorAll<HTMLElement>('[data-building-id]')];
    const item = id ? items.find(el => el.dataset.buildingId === id) : items.find(el => el.getBoundingClientRect().bottom > top + 70);
    anchor.current = item ? { id: item.dataset.buildingId!, offset: item.getBoundingClientRect().top - top } : null;
    writeIndexState({ anchor: anchor.current, scrollTop: root.scrollTop });
  };
  useLayoutEffect(() => {
    const root = homeRef.current;
    if (!root || !restore.current || projects.length === 0) return;
    const item = [...root.querySelectorAll<HTMLElement>('[data-building-id]')].find(el => el.dataset.buildingId === anchor.current?.id);
    if (item && anchor.current) root.scrollTop += item.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.current.offset;
    else root.scrollTop = initial.scrollTop ?? 0;
    restore.current = false;
  }, [projects, view, initial]);
  const changeView = (next: 'cards' | 'list') => {
    remember(); restore.current = true; setView(next);
    try { localStorage.setItem('project-index-view', next); } catch { /* Optional preference. */ }
  };
  const batch = async (complete: boolean) => {
    if (running.current || selectedIds.size === 0) return;
    const targets = projects.filter(p => selectedIds.has(p.building_id));
    if (complete && !window.confirm(`确认检查并完成选中的 ${targets.length} 栋建筑？通过检查后将自动审核并设为只读。`)) return;
    running.current = true; setBusy(true); setFailures({}); setMessage('');
    let cursor = 0, done = 0, skipped = 0;
    const errors: Record<string, string> = {};
    try {
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
        while (cursor < targets.length) {
          const project = targets[cursor++];
          try {
            const result = await checkProject(project.building_id, project.revision, complete);
            setProjects(current => current.map(p => p.building_id === project.building_id ? result.summary : p));
            if (result.outcome === 'failed') errors[project.building_id] = '校验失败，请查看检查详情';
            if (result.outcome === 'skipped') skipped++;
          } catch (error) {
            errors[project.building_id] = error instanceof ApiError ? `${error.code}: ${error.message}` : '网络异常，无法确认结果，请刷新后重试';
          }
          done++;
          setProgress(`${complete ? '批量完成' : '批量检查'}：${done} / ${targets.length}`);
          setFailures({ ...errors });
        }
      }));
      setMessage(`处理结束：成功 ${done - Object.keys(errors).length - skipped} 栋，失败 ${Object.keys(errors).length} 栋，跳过 ${skipped} 栋。`);
    } finally { setBusy(false); running.current = false; }
  };
  return { view, changeView, query, setQuery, status, setStatus, check, setCheck, sort, setSort, visible, filtered, pinned, setPinned,
    highlight, details, setDetails, busy, batch, progress, failures, homeRef, remember, retry: () => setSelectedIds(new Set(Object.keys(failures))),
    retained: pinned && visible.some(p => p.building_id === pinned && !matches(p)) };
}
