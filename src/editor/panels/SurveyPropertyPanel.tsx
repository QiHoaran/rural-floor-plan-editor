import { useEffect, useState } from 'react';
import type { HouseholdSurvey } from '@/editor/domain/buildingTypes.ts';
import { SURVEY_ENUM_OPTIONS } from '@/editor/domain/surveyData.ts';
import { synchronizeClearHeight } from '@/editor/domain/surveyData.ts';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import { removeReferenceImage } from '@/api/projectApi.ts';
import { uploadReferenceImageFile } from '@/projects/imageFile.ts';
import styles from './EditablePropertyPanel.module.css';

const NUMBER_FIELDS: Array<{
  key: keyof HouseholdSurvey;
  label: string;
  integer?: boolean;
  step?: string;
  millimeters?: boolean;
  positive?: boolean;
}> = [
  { key: 'age', label: '年龄', integer: true },
  { key: 'resident_count', label: '家庭常驻人口数', integer: true },
  { key: 'clear_height_mm', label: '建筑净高（米）', step: '0.1', millimeters: true, positive: true },
  { key: 'main_room_bay_mm', label: '正房开间（米）', step: '0.1', millimeters: true },
  { key: 'main_room_width_mm', label: '正房面宽（米）', step: '0.1', millimeters: true },
  { key: 'wing_room_bay_mm', label: '厢房开间（米）', step: '0.1', millimeters: true },
  { key: 'wing_room_width_mm', label: '厢房面宽（米）', step: '0.1', millimeters: true },
  { key: 'bay_count', label: '开间数', integer: true },
];

const SELECT_FIELDS: Array<{
  key: keyof typeof SURVEY_ENUM_OPTIONS;
  label: string;
}> = [
  { key: 'gender', label: '性别' },
  { key: 'family_structure', label: '人口结构' },
  { key: 'annual_income', label: '家庭年收入' },
  { key: 'primary_income_source', label: '主要收入来源' },
  { key: 'construction_era', label: '房屋建造年代' },
  { key: 'building_area', label: '建筑面积' },
  { key: 'plan_form', label: '平面形式' },
  { key: 'building_structure', label: '建筑结构' },
];

export function SurveyPropertyPanel() {
  const document = useEditorStore((state) => state.buildingDocument)!;
  const transact = useEditorStore((state) => state.transact);
  const finishSave = useEditorStore((state) => state.finishBuildingSave);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageMessage, setImageMessage] = useState('');
  const [imageError, setImageError] = useState('');
  const survey = document.survey ?? {
    village_code: document.metadata.village_code ?? '',
    household_code: document.metadata.household_code ?? '',
  };

  const attachImage = async (file: File | undefined) => {
    if (!file || imageBusy) return;
    setImageBusy(true);
    setImageError('');
    setImageMessage('');
    try {
      const saved = await uploadReferenceImageFile(document.building_id, file);
      finishSave(saved);
      setImageMessage('参考图已导入，可以开始标定和绘制。');
    } catch (error) {
      setImageError(error instanceof Error ? error.message : '参考图导入失败');
    } finally {
      setImageBusy(false);
    }
  };

  const deleteImage = async () => {
    if (imageBusy) return;
    if (!confirm('确定删除当前参考图？原文件会移入项目内部备份目录。')) return;
    setImageBusy(true);
    setImageError('');
    setImageMessage('');
    try {
      const saved = await removeReferenceImage(document.building_id);
      finishSave(saved);
      setImageMessage('参考图已删除，原文件已备份。');
    } catch (error) {
      setImageError(error instanceof Error ? error.message : '参考图删除失败');
    } finally {
      setImageBusy(false);
    }
  };

  const update = (key: keyof HouseholdSurvey, value: string | number | undefined) => {
    transact('修改住户调查属性', (current) => {
      const nextSurvey = {
        village_code: current.survey?.village_code ?? current.metadata.village_code ?? '',
        household_code: current.survey?.household_code ?? current.metadata.household_code ?? '',
        ...current.survey,
        [key]: value,
      } as HouseholdSurvey;
      if (value === undefined) delete nextSurvey[key];
      const nextDocument = {
        ...current,
        survey: nextSurvey,
        metadata: {
          ...current.metadata,
          village_code: nextSurvey.village_code || undefined,
          household_code: nextSurvey.household_code || undefined,
        },
      };
      return key === 'clear_height_mm'
        ? synchronizeClearHeight(nextDocument)
        : nextDocument;
    });
  };

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>住户与建筑属性</div>
      <div className={styles.content}>
        <p className={styles.helper}>修改后会随当前建筑自动保存到 JSON，枚举属性直接保存为中文内容。</p>
        <div className={styles.sectionTitle}>参考草图</div>
        {document.reference_image.path ? (
          <>
            <div className={styles.readOnly}>{document.reference_image.path}</div>
            <button
              type="button"
              className={styles.dangerBtn}
              disabled={imageBusy}
              onClick={() => void deleteImage()}
            >
              删除参考图
            </button>
          </>
        ) : (
          <label className={styles.field}>
            <span>导入参考草图</span>
            <input
              aria-label="导入参考草图"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={imageBusy}
              onChange={(event) => void attachImage(event.target.files?.[0])}
            />
          </label>
        )}
        {imageBusy && <div className={styles.helper}>正在导入参考图…</div>}
        {imageMessage && <div className={styles.success}>{imageMessage}</div>}
        {imageError && <div className={styles.error}>{imageError}</div>}
        <div className={styles.sectionTitle}>基本信息</div>
        <TextField label="村号（rural）" value={survey.village_code} onChange={(value) => update('village_code', value)} />
        <TextField label="户号（house）" value={survey.household_code} onChange={(value) => update('household_code', value)} />

        <div className={styles.sectionTitle}>家庭信息</div>
        {SELECT_FIELDS.slice(0, 4).map((field) => (
          <SurveySelect key={field.key} label={field.label} value={survey[field.key]} options={SURVEY_ENUM_OPTIONS[field.key]} onChange={(value) => update(field.key, value)} />
        ))}
        {NUMBER_FIELDS.slice(0, 2).map((field) => (
          <SurveyNumberField key={field.key} label={field.label} integer={field.integer} step={field.step} value={survey[field.key] as number | undefined} onCommit={(value) => update(field.key, value)} />
        ))}

        <div className={styles.sectionTitle}>房屋信息</div>
        {SELECT_FIELDS.slice(4).map((field) => (
          <SurveySelect key={field.key} label={field.label} value={survey[field.key]} options={SURVEY_ENUM_OPTIONS[field.key]} onChange={(value) => update(field.key, value)} />
        ))}
        {NUMBER_FIELDS.slice(2).map((field) => (
          <SurveyNumberField
            key={field.key}
            label={field.label}
            integer={field.integer}
            positive={field.positive}
            step={field.step}
            value={typeof survey[field.key] === 'number' && field.millimeters
              ? (survey[field.key] as number) / 1000
              : survey[field.key] as number | undefined}
            onCommit={(value) => update(
              field.key,
              value === undefined || !field.millimeters
                ? value
                : Math.round(value * 1000),
            )}
          />
        ))}
      </div>
    </aside>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SurveySelect({ label, value, options, onChange }: {
  label: string;
  value: unknown;
  options: readonly { code: number; value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select aria-label={label} value={value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">请选择</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function SurveyNumberField({ label, value, integer, positive, step = 'any', onCommit }: {
  label: string;
  value?: number;
  integer?: boolean;
  positive?: boolean;
  step?: string;
  onCommit: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const [error, setError] = useState('');
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    if (!draft.trim()) { onCommit(undefined); setError(''); return; }
    const parsed = Number(draft.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0 || (positive && parsed <= 0) || (integer && !Number.isInteger(parsed))) {
      setError(positive ? '请输入大于 0 的数字' : integer ? '请输入非负整数' : '请输入非负数字');
      return;
    }
    onCommit(parsed); setDraft(String(parsed)); setError('');
  };
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input aria-label={label} type="number" min={positive ? '0.001' : '0'} step={integer ? '1' : step} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') commit(); }} />
      {error && <small className={styles.inlineError}>{error}</small>}
    </label>
  );
}
