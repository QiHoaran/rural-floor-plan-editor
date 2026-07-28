// ============================================================
// 数据质量面板 — 显示校验问题，支持筛选、定位和高亮
// ============================================================

import { useMemo, useState } from 'react';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import type {
  ValidationIssue,
  ValidationCategory,
  ValidationSeverity,
} from '@/editor/domain/buildingTypes.ts';
import {
  getValidationMessageZh,
  getFixSuggestionZh,
  filterIssuesByCategory,
  filterIssuesBySeverity,
  getIssuesForEntity,
} from '@/editor/domain/buildingValidation.ts';
import styles from './DataQualityPanel.module.css';

const CATEGORY_LABELS: Record<ValidationCategory | 'all', string> = {
  all: '全部',
  schema: '数据格式',
  geometry: '几何',
  topology: '拓扑',
  semantic: '语义',
  accessibility: '通行',
  ventilation: '通风',
  daylighting: '采光',
  reference: '参考图',
  workflow: '工作流',
};

const SEVERITY_LABELS: Record<ValidationSeverity | 'all', string> = {
  all: '全部',
  error: '错误',
  warning: '警告',
  info: '信息',
};

const ALL_CATEGORIES: (ValidationCategory | 'all')[] = [
  'all', 'schema', 'geometry', 'topology', 'semantic',
  'accessibility', 'ventilation', 'daylighting', 'reference', 'workflow',
];

const ALL_SEVERITIES: (ValidationSeverity | 'all')[] = [
  'all', 'error', 'warning', 'info',
];

export function DataQualityPanel() {
  const document = useEditorStore((state) => state.buildingDocument);
  const selection = useEditorStore((state) => state.selection);
  const setSelection = useEditorStore((state) => state.setSelection);
  const [categoryFilter, setCategoryFilter] = useState<ValidationCategory | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<ValidationSeverity | 'all'>('all');

  const allIssues = useMemo(() => {
    if (!document) return [];
    const structured = document.structured_validation ?? [];
    // Also convert old-style issues
    const oldIssues: ValidationIssue[] = (document.validation?.issues ?? []).map(
      (issue) => ({
        id: issue.id,
        code: issue.code,
        severity: issue.level,
        category: 'geometry' as ValidationCategory,
        message_key: issue.code,
        entity_type: issue.entity?.type,
        entity_id: issue.entity?.id,
        created_at: new Date().toISOString(),
      }),
    );
    return [...structured, ...oldIssues];
  }, [document]);

  const filteredIssues = useMemo(() => {
    let result = allIssues;
    result = filterIssuesByCategory(result, categoryFilter);
    result = filterIssuesBySeverity(result, severityFilter);
    return result;
  }, [allIssues, categoryFilter, severityFilter]);

  // 当前选中实体的问题
  const entityIssues = useMemo(() => {
    if (!selection || !selection.id) return [];
    const entityType = selection.type === 'outside_region'
      ? 'outside_region'
      : selection.type;
    return getIssuesForEntity(
      allIssues,
      entityType,
      selection.id,
    );
  }, [allIssues, selection]);

  const errorCount = allIssues.filter((i) => i.severity === 'error').length;
  const warningCount = allIssues.filter((i) => i.severity === 'warning').length;
  const infoCount = allIssues.filter((i) => i.severity === 'info').length;

  const handleClickIssue = (issue: ValidationIssue) => {
    if (!issue.entity_type || !issue.entity_id) return;
    if (issue.entity_type === 'building') return;

    const entityType = issue.entity_type === 'outside_region'
      ? 'outside_region'
      : issue.entity_type;
    setSelection({ type: entityType, id: issue.entity_id });
  };

  if (!document) return null;

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <span>数据质量</span>
        <span className={styles.counts}>
          <span className={styles.errorCount} title="错误">
            {errorCount}
          </span>
          {' '}
          <span className={styles.warningCount} title="警告">
            {warningCount}
          </span>
          {' '}
          <span className={styles.infoCount} title="信息">
            {infoCount}
          </span>
        </span>
      </div>

      {/* 筛选 */}
      <div className={styles.filters}>
        <select
          aria-label="分类筛选"
          className={styles.filterSelect}
          value={categoryFilter}
          onChange={(e) =>
            setCategoryFilter(e.target.value as ValidationCategory | 'all')
          }
        >
          {ALL_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>
        <select
          aria-label="严重程度筛选"
          className={styles.filterSelect}
          value={severityFilter}
          onChange={(e) =>
            setSeverityFilter(e.target.value as ValidationSeverity | 'all')
          }
        >
          {ALL_SEVERITIES.map((sev) => (
            <option key={sev} value={sev}>
              {SEVERITY_LABELS[sev]}
            </option>
          ))}
        </select>
      </div>

      {/* 当前实体问题 */}
      {selection && entityIssues.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>当前实体问题</div>
          {entityIssues.map((issue) => (
            <IssueItem
              key={issue.id}
              issue={issue}
              onClick={() => handleClickIssue(issue)}
            />
          ))}
        </div>
      )}

      {/* 全部问题列表 */}
      <div className={styles.issueList}>
        {filteredIssues.length === 0 ? (
          <div className={styles.empty}>
            {allIssues.length === 0
              ? '没有发现问题'
              : '没有匹配的问题'}
          </div>
        ) : (
          filteredIssues.map((issue) => (
            <IssueItem
              key={issue.id}
              issue={issue}
              onClick={() => handleClickIssue(issue)}
              active={
                selection?.id === issue.entity_id &&
                selection?.type === issue.entity_type
              }
            />
          ))
        )}
      </div>

      {/* 统计摘要 */}
      <div className={styles.summary}>
        共 {filteredIssues.length} 个问题
        {categoryFilter !== 'all' && `（${CATEGORY_LABELS[categoryFilter]}）`}
      </div>
    </aside>
  );
}

function IssueItem({
  issue,
  onClick,
  active,
}: {
  issue: ValidationIssue;
  onClick: () => void;
  active?: boolean;
}) {
  const message = getValidationMessageZh(issue);
  const suggestion = getFixSuggestionZh(issue);

  return (
    <button
      className={`${styles.issueItem} ${styles[issue.severity]} ${
        active ? styles.active : ''
      }`}
      onClick={onClick}
      title={suggestion ?? undefined}
    >
      <span
        className={styles.severityBadge}
        data-severity={issue.severity}
      >
        {issue.severity === 'error' ? '✕' : issue.severity === 'warning' ? '⚠' : 'ℹ'}
      </span>
      <span className={styles.issueMessage}>{message}</span>
      {issue.entity_type && issue.entity_id && (
        <span className={styles.entityRef}>
          {issue.entity_type}:{issue.entity_id.slice(0, 8)}
        </span>
      )}
    </button>
  );
}
