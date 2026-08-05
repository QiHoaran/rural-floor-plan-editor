import type { BuildingDocument, HouseholdSurvey } from './buildingTypes.ts';

export const SURVEY_COLUMNS = [
  'rural',
  'house',
  '性别',
  '年龄',
  '家庭常驻人口数',
  '人口结构',
  '家庭年收入',
  '主要收入来源',
  '房屋建造年代',
  '建筑面积',
  '建筑净高（米）',
  '平面形式',
  '建筑结构',
  '正房开间（米）',
  '正房面宽（米）',
  '厢房开间（米）',
  '厢房面宽（米）',
  '开间数',
] as const;

export const SURVEY_ENUM_OPTIONS = {
  gender: [
    { code: 1, value: '男性', label: '男性' },
    { code: 2, value: '女性', label: '女性' },
  ],
  family_structure: [
    { code: 1, value: '两人户（年轻夫妻）', label: '两人户（年轻夫妻）' },
    { code: 2, value: '两人户（老年夫妻）', label: '两人户（老年夫妻）' },
    { code: 3, value: '中年夫妻 + 未婚子女', label: '中年夫妻 + 未婚子女' },
    { code: 4, value: '老年夫妻 + 已婚子女', label: '老年夫妻 + 已婚子女' },
    { code: 5, value: '三代户', label: '三代户' },
    { code: 6, value: '隔代户（老年夫妻 + 隔代儿童）', label: '隔代户（老年夫妻 + 隔代儿童）' },
    { code: 7, value: '独居', label: '独居' },
  ],
  annual_income: [
    { code: 1, value: '小于 10000', label: '小于 10000' },
    { code: 2, value: '10000–20000', label: '10000–20000' },
    { code: 3, value: '20001–30000', label: '20001–30000' },
    { code: 4, value: '30001–40000', label: '30001–40000' },
    { code: 5, value: '40000–50000', label: '40000–50000' },
    { code: 6, value: '50001 以上', label: '50001 以上' },
  ],
  primary_income_source: [
    { code: 1, value: '养殖', label: '养殖' },
    { code: 2, value: '种田', label: '种田' },
    { code: 3, value: '果林', label: '果林' },
    { code: 4, value: '经商', label: '经商' },
    { code: 5, value: '打工', label: '打工' },
    { code: 6, value: '其他副业', label: '其他副业' },
  ],
  construction_era: [
    { code: 1, value: '1950 年代', label: '1950 年代' },
    { code: 2, value: '1960 年代', label: '1960 年代' },
    { code: 3, value: '1970 年代', label: '1970 年代' },
    { code: 4, value: '1980 年代', label: '1980 年代' },
    { code: 5, value: '1990 年代', label: '1990 年代' },
    { code: 6, value: '2000 年及以后', label: '2000 年及以后' },
    { code: 7, value: '1940 年代', label: '1940 年代' },
    { code: 8, value: '1930 年代', label: '1930 年代' },
    { code: 9, value: '1920 年代及以前', label: '1920 年代及以前' },
    { code: 0, value: '不确定', label: '不确定' },
  ],
  building_area: [
    { code: 1, value: '30–40 ㎡', label: '30–40 ㎡' },
    { code: 2, value: '40–50 ㎡', label: '40–50 ㎡' },
    { code: 3, value: '50–60 ㎡', label: '50–60 ㎡' },
    { code: 4, value: '60–70 ㎡', label: '60–70 ㎡' },
    { code: 5, value: '70–80 ㎡', label: '70–80 ㎡' },
    { code: 6, value: '80–90 ㎡', label: '80–90 ㎡' },
    { code: 7, value: '90–100 ㎡', label: '90–100 ㎡' },
    { code: 8, value: '100–110 ㎡', label: '100–110 ㎡' },
    { code: 9, value: '20–30 ㎡', label: '20–30 ㎡' },
  ],
  plan_form: [
    { code: 1, value: '一字型', label: '一字型' },
    { code: 2, value: 'L 型', label: 'L 型' },
    { code: 3, value: 'U 型', label: 'U 型' },
    { code: 4, value: '回字型', label: '回字型' },
    { code: 5, value: '其他', label: '其他' },
  ],
  building_structure: [
    { code: 1, value: '土坯结构', label: '土坯结构' },
    { code: 2, value: '砖瓦结构', label: '砖瓦结构' },
    { code: 3, value: '砖混结构', label: '砖混结构' },
    { code: 4, value: '钢筋混凝土结构', label: '钢筋混凝土结构' },
    { code: 5, value: '石结构', label: '石结构' },
  ],
} as const;

export interface SurveyParseIssue {
  row: number;
  message: string;
}

export interface SurveyParseResult {
  records: HouseholdSurvey[];
  issues: SurveyParseIssue[];
}

const HEADER_ALIASES: Record<string, keyof HouseholdSurvey> = {
  rural: 'village_code',
  village_code: 'village_code',
  村号: 'village_code',
  house: 'household_code',
  household_code: 'household_code',
  户号: 'household_code',
  性别: 'gender',
  gender: 'gender',
  年龄: 'age',
  age: 'age',
  家庭常驻人口数: 'resident_count',
  resident_count: 'resident_count',
  人口结构: 'family_structure',
  family_structure: 'family_structure',
  家庭年收入: 'annual_income',
  annual_income: 'annual_income',
  主要收入来源: 'primary_income_source',
  primary_income_source: 'primary_income_source',
  房屋建造年代: 'construction_era',
  construction_era: 'construction_era',
  建筑面积: 'building_area',
  building_area: 'building_area',
  '建筑净高（米）': 'clear_height_mm',
  '建筑净高(米)': 'clear_height_mm',
  clear_height_m: 'clear_height_mm',
  clear_height_mm: 'clear_height_mm',
  平面形式: 'plan_form',
  plan_form: 'plan_form',
  建筑结构: 'building_structure',
  building_structure: 'building_structure',
  '正房开间（米）': 'main_room_bay_mm',
  '正房开间(米)': 'main_room_bay_mm',
  main_room_bay_m: 'main_room_bay_mm',
  main_room_bay_mm: 'main_room_bay_mm',
  '正房面宽（米）': 'main_room_width_mm',
  '正房面宽(米)': 'main_room_width_mm',
  main_room_width_m: 'main_room_width_mm',
  main_room_width_mm: 'main_room_width_mm',
  '厢房开间（米）': 'wing_room_bay_mm',
  '厢房开间(米)': 'wing_room_bay_mm',
  wing_room_bay_m: 'wing_room_bay_mm',
  wing_room_bay_mm: 'wing_room_bay_mm',
  '厢房面宽（米）': 'wing_room_width_mm',
  '厢房面宽(米)': 'wing_room_width_mm',
  wing_room_width_m: 'wing_room_width_mm',
  wing_room_width_mm: 'wing_room_width_mm',
  开间数: 'bay_count',
  bay_count: 'bay_count',
};

type SurveyEnumKey = keyof typeof SURVEY_ENUM_OPTIONS;
const ENUM_KEYS = Object.keys(SURVEY_ENUM_OPTIONS) as SurveyEnumKey[];

const INTEGER_FIELDS = new Set<keyof HouseholdSurvey>([
  'age',
  'resident_count',
  'bay_count',
]);

const MILLIMETER_FIELDS = new Set<keyof HouseholdSurvey>([
  'clear_height_mm',
  'main_room_bay_mm',
  'main_room_width_mm',
  'wing_room_bay_mm',
  'wing_room_width_mm',
]);

export function parseSurveyText(text: string): SurveyParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { records: [], issues: [{ row: 0, message: '导入内容为空' }] };

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return parseObjects(rows);
    } catch {
      return { records: [], issues: [{ row: 0, message: 'JSON 格式无效' }] };
    }
  }

  const delimiter = trimmed.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const rows = parseDelimited(trimmed, delimiter);
  if (rows.length < 2) {
    return { records: [], issues: [{ row: 1, message: '需要表头和至少一行数据' }] };
  }
  const headers = rows[0].map((value) => value.trim());
  const objects = rows.slice(1).map((values) =>
    Object.fromEntries(
      values.flatMap((value, index) =>
        HEADER_ALIASES[headers[index]] ? [[headers[index], value]] : [],
      ),
    ),
  );
  return parseObjects(objects, 2);
}

export function createSurveyBuildingId(survey: HouseholdSurvey): string {
  const safe = (value: string, width: number) => {
    const normalized = value.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return /^\d+$/.test(normalized) ? normalized.padStart(width, '0') : normalized;
  };
  return `rural_${safe(survey.village_code, 3)}_house_${safe(survey.household_code, 4)}`;
}

export function normalizeSurveyForStorage(raw: Record<string, unknown>): HouseholdSurvey {
  const normalized = { ...raw };
  const legacyMeterFields: Array<[string, keyof HouseholdSurvey]> = [
    ['clear_height_m', 'clear_height_mm'],
    ['main_room_bay_m', 'main_room_bay_mm'],
    ['main_room_width_m', 'main_room_width_mm'],
    ['wing_room_bay_m', 'wing_room_bay_mm'],
    ['wing_room_width_m', 'wing_room_width_mm'],
  ];
  for (const [oldKey, newKey] of legacyMeterFields) {
    if (normalized[newKey] === undefined && typeof normalized[oldKey] === 'number') {
      normalized[newKey] = Math.round(normalized[oldKey] * 1000);
    }
    delete normalized[oldKey];
  }
  if (normalized.construction_era === '1950 年代及以前') {
    normalized.construction_era = '1950 年代';
  } else if (normalized.construction_era === '年代不详') {
    normalized.construction_era = '1920 年代及以前';
  }
  for (const key of ENUM_KEYS) {
    const value = normalized[key];
    if (value === undefined || value === null || value === '') continue;
    const text = String(value).trim();
    const option = SURVEY_ENUM_OPTIONS[key].find(
      (entry) => String(entry.code) === text || entry.value === text,
    );
    if (option) normalized[key] = option.value;
  }
  return normalized as unknown as HouseholdSurvey;
}

/**
 * 调查净高是界面中的唯一高度来源；旧 JSON 字段继续同步保留，
 * 供现有墙体命令、GeoJSON 和研究导出使用。
 */
export function synchronizeClearHeight(
  document: BuildingDocument,
): BuildingDocument {
  const clearHeight = document.survey?.clear_height_mm;
  if (
    !Number.isSafeInteger(clearHeight) ||
    clearHeight === undefined ||
    clearHeight <= 0
  ) {
    return document;
  }

  const walls = Object.fromEntries(
    Object.entries(document.walls).map(([wallId, wall]) => [
      wallId,
      wall.height_mm === clearHeight
        ? wall
        : { ...wall, height_mm: clearHeight },
    ]),
  );

  return {
    ...document,
    building_defaults: {
      ...document.building_defaults,
      wall_height_mm: clearHeight,
    },
    walls,
  };
}

function parseObjects(rows: unknown[], firstRow = 1): SurveyParseResult {
  const records: HouseholdSurvey[] = [];
  const issues: SurveyParseIssue[] = [];
  rows.forEach((raw, index) => {
    const row = firstRow + index;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({ row, message: '记录必须是对象' });
      return;
    }
    const source = raw as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    const storedMillimeterFields = new Set<keyof HouseholdSurvey>();
    for (const [header, value] of Object.entries(source)) {
      const key = HEADER_ALIASES[header.trim()] ?? header;
      normalized[key] = value;
      if (header.trim().endsWith('_mm')) {
        storedMillimeterFields.add(key as keyof HouseholdSurvey);
      }
    }
    const result = normalizeSurvey(normalized, storedMillimeterFields);
    if (result.error) issues.push({ row, message: result.error });
    else records.push(result.survey!);
  });
  return { records, issues };
}

function normalizeSurvey(
  source: Record<string, unknown>,
  storedMillimeterFields = new Set<keyof HouseholdSurvey>(),
): { survey?: HouseholdSurvey; error?: string } {
  const village = String(source.village_code ?? '').trim();
  const household = String(source.household_code ?? '').trim();
  if (!village || !household) return { error: 'rural/house（村号/户号）不能为空' };
  const survey: Record<string, unknown> = { village_code: village, household_code: household };
  for (const key of Object.values(HEADER_ALIASES)) {
    if (key === 'village_code' || key === 'household_code' || survey[key] !== undefined) continue;
    const raw = source[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    if (ENUM_KEYS.includes(key as SurveyEnumKey)) {
      const enumKey = key as SurveyEnumKey;
      const text = String(raw).trim();
      const option = SURVEY_ENUM_OPTIONS[enumKey].find(
        (entry) => String(entry.code) === text || entry.value === text,
      );
      if (!option) return { error: `${key} 的值 ${text} 不在允许范围内` };
      survey[key] = option.value;
      continue;
    }
    let value = Number(String(raw).trim().replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) return { error: `${key} 必须是非负数字` };
    if (MILLIMETER_FIELDS.has(key) && !storedMillimeterFields.has(key)) {
      value = Math.round(value * 1000);
    }
    if (MILLIMETER_FIELDS.has(key) && !Number.isSafeInteger(value)) {
      return { error: `${key} 转换后必须是安全的整数毫米` };
    }
    if (INTEGER_FIELDS.has(key) && !Number.isInteger(value)) return { error: `${key} 必须是整数` };
    survey[key] = value;
  }
  return { survey: survey as unknown as HouseholdSurvey };
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(value); value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += char;
  }
  row.push(value); rows.push(row);
  return rows.filter((values) => values.some((entry) => entry.trim() !== ''));
}
