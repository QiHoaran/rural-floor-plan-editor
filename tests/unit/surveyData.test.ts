import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import {
  createSurveyBuildingId,
  normalizeSurveyForStorage,
  parseSurveyText,
  SURVEY_COLUMNS,
  synchronizeClearHeight,
} from '../../src/editor/domain/surveyData.ts';

describe('survey data import', () => {
  it('parses the provided tab-separated format and keeps numeric codes', () => {
    const text = [
      SURVEY_COLUMNS.join('\t'),
      '1\t1\t1\t69\t2\t2\t4\t5\t6\t3\t2.5\t1\t5\t13\t5\t0\t0\t4',
      '1\t2\t1\t65\t2\t2\t4\t1\t4\t1\t2.5\t1\t3\t8\t5\t0\t0\t3',
    ].join('\n');

    const result = parseSurveyText(text);

    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      village_code: '1',
      household_code: '1',
      gender: '男性',
      age: 69,
      construction_era: '2000 年及以后',
      building_area: '50–60 ㎡',
      clear_height_mm: 2500,
      main_room_bay_mm: 13000,
      main_room_width_mm: 5000,
      building_structure: '石结构',
      bay_count: 4,
    });
  });

  it('normalizes numeric project IDs with required padding', () => {
    expect(createSurveyBuildingId({ village_code: '1', household_code: '2' }))
      .toBe('rural_001_house_0002');
    expect(createSurveyBuildingId({ village_code: '012', household_code: '0042' }))
      .toBe('rural_012_house_0042');
  });

  it('reports invalid enum codes without importing the bad row', () => {
    const result = parseSurveyText('rural,house,性别\n1,1,9');
    expect(result.records).toEqual([]);
    expect(result.issues[0].message).toContain('gender');
  });

  it('accepts JSON records with English field names', () => {
    const result = parseSurveyText(JSON.stringify([
      { village_code: '2', household_code: '7', gender: 2, age: 41 },
    ]));
    expect(result).toEqual({
      records: [{ village_code: '2', household_code: '7', gender: '女性', age: 41 }],
      issues: [],
    });
  });

  it('accepts the 15-row dataset where construction era code 9 means 1920s or earlier', () => {
    const rows = [
      '1\t1\t1\t69\t2\t2\t4\t5\t6\t3\t2.5\t1\t5\t13\t5\t0\t0\t4',
      '1\t2\t1\t65\t2\t2\t4\t1\t4\t1\t2.5\t1\t3\t8\t5\t0\t0\t3',
      '1\t3\t1\t84\t1\t7\t1\t2\t9\t1\t2.5\t1\t5\t10\t4\t0\t0\t4',
      '1\t4\t1\t83\t2\t2\t1\t2\t9\t1\t2.5\t1\t5\t8\t4\t0\t0\t3',
      '1\t5\t1\t82\t1\t7\t1\t2\t9\t1\t2.5\t1\t5\t8\t4.5\t0\t0\t3',
      '1\t6\t1\t74\t1\t7\t1\t2\t4\t2\t2.5\t1\t5\t10\t4\t0\t0\t4',
      '1\t7\t2\t72\t2\t2\t1\t2\t3\t2\t2.5\t1\t3\t10\t4\t0\t0\t4',
      '1\t8\t2\t65\t2\t2\t1\t2\t4\t2\t2.5\t1\t5\t10\t4\t0\t0\t4',
      '1\t9\t1\t83\t1\t7\t1\t2\t3\t2\t2.5\t1\t5\t10\t4\t0\t0\t4',
      '1\t10\t2\t66\t2\t2\t2\t2\t9\t3\t2.5\t2\t5\t13\t4\t2.5\t4\t5',
      '1\t11\t1\t81\t2\t2\t1\t2\t9\t1\t2.5\t1\t5\t8\t4\t0\t0\t3',
      '1\t12\t2\t63\t2\t2\t4\t2\t9\t3\t2.5\t1\t5\t13\t4\t0\t0\t5',
      '1\t13\t1\t81\t1\t7\t1\t2\t9\t2\t2.5\t1\t5\t10\t4\t0\t0\t4',
      '1\t14\t2\t68\t2\t2\t2\t2\t9\t3\t2.5\t2\t5\t10\t4\t2.5\t3\t4',
      '1\t15\t2\t60\t2\t2\t3\t5\t3\t3\t2.5\t1\t5\t13\t5\t0\t0\t4',
    ];

    const result = parseSurveyText([SURVEY_COLUMNS.join('\t'), ...rows].join('\n'));

    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(15);
    expect(result.records.filter((record) => record.construction_era === '1920 年代及以前')).toHaveLength(8);
    expect(createSurveyBuildingId(result.records[14])).toBe('rural_001_house_0015');
  });

  it('normalizes legacy numeric enum values to Chinese JSON values', () => {
    expect(normalizeSurveyForStorage({
      village_code: '1',
      household_code: '1',
      gender: 1,
      family_structure: 7,
      construction_era: 9,
      plan_form: 2,
    })).toMatchObject({
      gender: '男性',
      family_structure: '独居',
      construction_era: '1920 年代及以前',
      plan_form: 'L 型',
    });
  });

  it('migrates legacy meter fields and preserves explicit millimeter JSON fields', () => {
    expect(normalizeSurveyForStorage({
      village_code: '1',
      household_code: '1',
      clear_height_m: 2.5,
      main_room_bay_m: 13,
    })).toMatchObject({
      clear_height_mm: 2500,
      main_room_bay_mm: 13000,
    });

    const parsed = parseSurveyText(JSON.stringify({
      village_code: '1',
      household_code: '1',
      clear_height_mm: 2500,
    }));
    expect(parsed.issues).toEqual([]);
    expect(parsed.records[0].clear_height_mm).toBe(2500);
  });

  it('supports all construction era codes including 0, 7, 8 and 9', () => {
    const result = parseSurveyText([
      'rural,house,房屋建造年代',
      '1,1,0',
      '1,2,7',
      '1,3,8',
      '1,4,9',
    ].join('\n'));
    expect(result.issues).toEqual([]);
    expect(result.records.map((record) => record.construction_era)).toEqual([
      '不确定', '1940 年代', '1930 年代', '1920 年代及以前',
    ]);
  });

  it('migrates the previous construction era labels to the clarified meanings', () => {
    expect(normalizeSurveyForStorage({
      village_code: '1', household_code: '1', construction_era: '年代不详',
    }).construction_era).toBe('1920 年代及以前');
    expect(normalizeSurveyForStorage({
      village_code: '1', household_code: '2', construction_era: '1950 年代及以前',
    }).construction_era).toBe('1950 年代');
  });

  it('uses clear height as the authoritative value for defaults and all walls', () => {
    const document = createEmptyBuilding('height', '');
    document.survey = {
      village_code: '1',
      household_code: '1',
      clear_height_mm: 2750,
    };
    document.vertices = {
      a: { x_mm: 0, y_mm: 0 },
      b: { x_mm: 1000, y_mm: 0 },
    };
    document.walls.wall = {
      start_vertex_id: 'a',
      end_vertex_id: 'b',
      wall_type: 'exterior',
      thickness_mm: 240,
      height_mm: 3200,
      material_type: 'brick',
    };

    const synchronized = synchronizeClearHeight(document);
    expect(synchronized.building_defaults.wall_height_mm).toBe(2750);
    expect(synchronized.walls.wall.height_mm).toBe(2750);

    const withoutSurveyHeight = createEmptyBuilding('legacy', '');
    withoutSurveyHeight.building_defaults.wall_height_mm = 3200;
    expect(synchronizeClearHeight(withoutSurveyHeight)).toBe(withoutSurveyHeight);
  });
});
