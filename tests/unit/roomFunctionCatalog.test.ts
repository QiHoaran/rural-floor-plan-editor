import { expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { reconcileRoomFunctions, roomFunctionCatalog, usedRoomFunctions } from '../../src/editor/domain/roomFunctionTemplates.ts';

it('merges names using catalog colors without changing unrelated room properties', () => {
  const doc = createEmptyBuilding('rooms', '');
  doc.custom_function_types = [{ code: 'old', name: ' Study ', color: '#000000' }];
  doc.faces.r = { boundary_vertex_ids: [], area_mm2: 0, function_code: 'old', display_name: 'Study', color: '#000000', local_name: '书房', heated: true, notes: 'keep' };
  const catalog = [{ code: 'new', name: 'study', color: '#aabbcc' }];
  const next = reconcileRoomFunctions(doc, catalog);
  expect(next.faces.r).toEqual({ ...doc.faces.r, function_code: 'new', display_name: 'study', color: '#aabbcc' });
  expect(next.custom_function_types).toEqual(catalog);
  expect(reconcileRoomFunctions(next, catalog)).toBe(next);
  doc.workflow.status = 'complete';
  expect(reconcileRoomFunctions(doc, catalog)).toBe(doc);
});

it('recovers only used functions and prefers built-ins for duplicate names', () => {
  const doc = createEmptyBuilding('rooms', '');
  doc.custom_function_types = [{ code: 'unused', name: 'Unused', color: '#000000' }];
  expect(usedRoomFunctions(doc)).toEqual([]);
  const catalog = roomFunctionCatalog([
    { code: 'a', name: 'Study', color: '#000000' },
    { code: 'b', name: ' study ', color: '#ffffff', is_builtin: true },
    { code: 'c', name: '卧室', color: '#123456', is_builtin: true },
  ]);
  expect(catalog.filter((item) => item.name.trim().toLowerCase() === 'study')).toEqual([{ code: 'b', name: ' study ', color: '#ffffff', is_builtin: true }]);
  expect(catalog.find((item) => item.name === '卧室')?.code).toBe('bedroom');
});
