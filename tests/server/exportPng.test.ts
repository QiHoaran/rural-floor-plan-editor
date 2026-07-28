import { describe, expect, it } from 'vitest';
import { renderPng } from '../../server/exportPng.js';

describe('renderPng', () => {
  it('converts a minimal SVG to a PNG buffer', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#ffffff"/>
</svg>`;
    const buffer = await renderPng(svg);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(buffer[0]).toBe(137);
    expect(buffer[1]).toBe(80);
    expect(buffer[2]).toBe(78);
    expect(buffer[3]).toBe(71);
  });

  it('renders SVG with shapes', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#ffffff"/>
  <circle cx="100" cy="100" r="50" fill="#334155"/>
</svg>`;
    const buffer = await renderPng(svg);
    expect(buffer.length).toBeGreaterThan(200);
  });
});
