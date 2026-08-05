import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Toolbar } from '../../src/editor/toolbar/Toolbar.tsx';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';

describe('CAD Toolbar', () => {
  beforeEach(() => {
    useEditorStore.getState().setTool('select');
  });

  it('activates the SVG wall tools', () => {
    render(<Toolbar />);

    fireEvent.click(screen.getByRole('button', { name: /外墙/ }));
    expect(useEditorStore.getState().tool).toBe('exterior_wall');

    fireEvent.click(screen.getByRole('button', { name: /多段线/ }));
    expect(useEditorStore.getState().tool).toBe('polyline_wall');
  });

  it('exposes a labelled toolbar and pressed state for the active tool', () => {
    render(<Toolbar />);

    expect(
      screen.getByRole('toolbar', { name: '绘图工具' }),
    ).toBeTruthy();
    const select = screen.getByRole('button', { name: /选择/ });
    const exterior = screen.getByRole('button', { name: /外墙/ });
    expect(select.getAttribute('aria-pressed')).toBe('true');
    expect(exterior.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(exterior);

    expect(select.getAttribute('aria-pressed')).toBe('false');
    expect(exterior.getAttribute('aria-pressed')).toBe('true');
  });

  it('uses the fixed reference-image direction instead of a north-setting tool', () => {
    render(<Toolbar />);

    expect(screen.queryByRole('button', { name: /设置北向/ })).toBeNull();
  });

  it.each([
    ['外门', 'exterior_door'],
    ['外窗', 'exterior_window'],
    ['内门', 'interior_door'],
    ['无门洞', 'passage'],
  ] as const)('activates the %s placement tool', (label, tool) => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(useEditorStore.getState().tool).toBe(tool);
  });
});
