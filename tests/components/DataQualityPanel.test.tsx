import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataQualityPanel } from '../../src/editor/panels/DataQualityPanel.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { createValidationIssue } from '../../src/editor/domain/buildingValidation.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';

describe('DataQualityPanel', () => {
  it('shows bay and detected face counts together with the repair suggestion', () => {
    const document = createEmptyBuilding('quality', '');
    document.structured_validation = [
      createValidationIssue('BAY_FACE_COUNT_MISMATCH', 'building', undefined, {
        bay_count: 4,
        face_count: 3,
      }),
    ];
    useEditorStore.getState().loadBuilding(document);

    render(<DataQualityPanel />);

    expect(screen.getByText('开间数为 4，当前检索到 3 个室内面')).toBeTruthy();
    expect(screen.getByText('建议：请检查墙体是否全部闭合，或核对房屋信息中的开间数'))
      .toBeTruthy();
  });
});
