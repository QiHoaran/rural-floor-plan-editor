import { useState, useRef, useLayoutEffect, useEffect, useMemo, useCallback, useDeferredValue } from 'react';
import { type ProjectSummary, checkProject, ApiError } from '@/api/projectApi.ts';

const KEY = 'project-index-v1';

/** 465 栋排序每次比较都构造 Collator 约 4,100 次，提到模块级复用。 */
const ID_COLLATOR = new Intl.Collator('zh-CN', { numeric: true });

interface IndexState {
  projects?: ProjectSummary[];
  query?: string;
  status?: string;
  check?: string;
  orthogonality?: string;
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
/** 只写项目列表，调用方已完成序列化，避免 writeIndexState 的二次 stringify。 */
export function writeIndexProjects(serialized: string) {
  try { sessionStorage.setItem(`${KEY}-projects`, serialized); } catch { /* Storage may be disabled. */ }
}
export function useProjectIndex(projects: ProjectSummary[], setProjects: React.Dispatch<React.SetStateAction<ProjectSummary[]>>,
  selectedIds: Set<string>, setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>, setMessage: (message: string) => void,
  initial: IndexState) {
  const [view, setView] = useState<'cards' | 'list'>(() => {
    try { return localStorage.getItem('project-index-view') === 'list' ? 'list' : 'cards'; } catch { return 'cards'; }
  });
  const [query, setQuery] = useState(initial.query ?? '');
  const [status, setStatus] = useState(initial.status ?? 'all');
  const [check, setCheck] = useState(initial.check ?? 'all');
  const [orthogonality, setOrthogonality] = useState(initial.orthogonality ?? 'all');
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
  const persistTimer = useRef(0);
  const lastWritten = useRef('');
  // 项目列表落盘防抖：批量检查时每栋建筑一次 setProjects，避免 465 次全量序列化。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const payload = JSON.stringify(projects);
      if (payload === lastWritten.current) return;
      lastWritten.current = payload;
      writeIndexProjects(payload);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [projects]);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  useEffect(() => () => {
    // 卸载时补写，防止防抖窗口内的最后一次变更丢失。
    const payload = JSON.stringify(projectsRef.current);
    if (payload !== lastWritten.current) writeIndexProjects(payload);
  }, []);
  useEffect(() => { writeIndexState({ query, status, check, orthogonality, sort, selected: [...selectedIds] }); }, [query, status, check, orthogonality, sort, selectedIds]);
  useEffect(() => { const timer = window.setTimeout(() => setHighlight(null), 2400); return () => clearTimeout(timer); }, [highlight]);
  const deferredQuery = useDeferredValue(query);
  const { filtered, visible, retained } = useMemo(() => {
    const q = deferredQuery.toLowerCase().trim();
    const matches = (p: ProjectSummary) => (`${p.building_id} ${p.name ?? ''}`.toLowerCase().includes(q)) && (status === 'all' || p.status === status) && (check === 'all' || (p.check?.status ?? 'unchecked') === check)
      && (orthogonality === 'all' || (p.non_axis_aligned_wall_count !== undefined && p.non_axis_aligned_face_edge_count !== undefined
        && ((p.non_axis_aligned_wall_count + p.non_axis_aligned_face_edge_count > 0) === (orthogonality === 'nonorthogonal'))));
    const filtered = projects.filter(matches);
    const pinnedProject = pinned ? projects.find(p => p.building_id === pinned) : undefined;
    const retained = Boolean(pinnedProject && !matches(pinnedProject));
    const rows = retained ? [...filtered, pinnedProject!] : filtered.slice();
    rows.sort((a, b) => {
      if (sort === 'updated') { const diff = (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0); if (diff) return diff; }
      if (sort === 'issues') { const diff = Number(b.check?.status === 'error') - Number(a.check?.status === 'error'); if (diff) return diff; }
      return ID_COLLATOR.compare(a.building_id, b.building_id);
    });
    return { filtered, visible: rows, retained };
  }, [projects, deferredQuery, status, check, orthogonality, sort, pinned]);
  const pendingScroll = useRef<{ anchor: { id: string; offset: number } | null; scrollTop: number } | null>(null);
  /** 打开建筑时记录的锚点优先：此后迟到的滚动回调不得覆盖它。 */
  const explicitAnchor = useRef(false);
  const remember = useCallback((id?: string) => {
    if (id) explicitAnchor.current = true;
    else if (explicitAnchor.current) return;
    const root = homeRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    const items = root.querySelectorAll<HTMLElement>('[data-building-id]');
    let found: HTMLElement | null = null;
    for (const el of items) {
      if (id ? el.dataset.buildingId === id : el.getBoundingClientRect().bottom > top + 70) { found = el; break; }
    }
    anchor.current = found ? { id: found.dataset.buildingId!, offset: found.getBoundingClientRect().top - top } : null;
    // 滚动事件高频触发，落盘做防抖。
    pendingScroll.current = { anchor: anchor.current, scrollTop: root.scrollTop };
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      const pending = pendingScroll.current;
      pendingScroll.current = null;
      if (pending) writeIndexState({ anchor: pending.anchor, scrollTop: pending.scrollTop });
    }, 300);
  }, []);
  useEffect(() => () => {
    // 打开编辑器会让首页卸载：必须补写，否则防抖窗口内的锚点丢失，返回后无法定位。
    window.clearTimeout(persistTimer.current);
    const pending = pendingScroll.current;
    if (pending) writeIndexState({ anchor: pending.anchor, scrollTop: pending.scrollTop });
  }, []);
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
    const summaries = new Map<string, ProjectSummary>();
    try {
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
        while (cursor < targets.length) {
          const project = targets[cursor++];
          try {
            const result = await checkProject(project.building_id, project.revision, complete);
            summaries.set(project.building_id, result.summary);
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
      // 一次性合并，避免每栋建筑都触发全列表重渲染与序列化。
      if (summaries.size > 0) setProjects(current => current.map(p => summaries.get(p.building_id) ?? p));
      setMessage(`处理结束：成功 ${done - Object.keys(errors).length - skipped} 栋，失败 ${Object.keys(errors).length} 栋，跳过 ${skipped} 栋。`);
    } finally { setBusy(false); running.current = false; }
  };
  return { view, changeView, query, setQuery, status, setStatus, check, setCheck, orthogonality, setOrthogonality, sort, setSort, visible, filtered, pinned, setPinned,
    highlight, details, setDetails, busy, batch, progress, failures, homeRef, remember, retry: () => setSelectedIds(new Set(Object.keys(failures))),
    retained };
}
