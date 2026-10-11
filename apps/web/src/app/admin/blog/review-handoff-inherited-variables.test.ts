import { describe, expect, it } from 'vitest';
import { inheritedCustomProperties } from './review-handoff-inherited-variables';

function entries(element: Element): Record<string, string> {
  return Object.fromEntries(inheritedCustomProperties(element));
}

describe('inheritedCustomProperties', () => {
  it('returns no properties with no styled ancestors', () => {
    const root = document.createElement('div');
    const child = document.createElement('p');
    root.appendChild(child);
    expect(entries(child)).toEqual({});
  });

  it('collects root-first with the closest ancestor winning', () => {
    const root = document.createElement('div');
    root.setAttribute('style', '--state:block;--outer:1');
    const mid = document.createElement('div');
    mid.setAttribute('style', '--state:none');
    const child = document.createElement('p');
    root.appendChild(mid);
    mid.appendChild(child);
    expect(entries(child)).toEqual({ '--state': 'none', '--outer': '1' });
  });

  it('ignores the element own block and non-custom declarations', () => {
    const root = document.createElement('div');
    root.setAttribute('style', 'display:none;--state:none');
    const child = document.createElement('p');
    child.setAttribute('style', '--state:block');
    root.appendChild(child);
    expect(entries(child)).toEqual({ '--state': 'none' });
  });

  it('skips ancestors without a style attribute', () => {
    const root = document.createElement('div');
    root.setAttribute('style', '--state:none');
    const mid = document.createElement('div');
    const child = document.createElement('p');
    root.appendChild(mid);
    mid.appendChild(child);
    expect(entries(child)).toEqual({ '--state': 'none' });
  });
});
