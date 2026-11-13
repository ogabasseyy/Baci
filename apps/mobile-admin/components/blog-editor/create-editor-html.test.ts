// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { DARK_COLORS, LIGHT_COLORS } from '@/constants/theme';
import {
  buildApplyEditorThemeScript,
  createEditorHtml,
} from './create-editor-html';
import { expectValidJavaScript } from './script-test-utils';

describe('createEditorHtml', () => {
  it('renders sanitized editor content and placeholder styles', () => {
    const html = createEditorHtml({
      colors: LIGHT_COLORS,
      content: '<p>Hello world</p><script>alert(1)</script>',
    });
    const document = new DOMParser().parseFromString(html, 'text/html');
    const editor = document.getElementById('editor');

    expect(editor?.querySelectorAll('p')).toHaveLength(1);
    expect(editor?.querySelector('p')?.textContent).toBe('Hello world');
    expect(editor?.querySelectorAll('script')).toHaveLength(0);
    expect(html).toContain('Start writing your story...');
    expect(html).toContain(LIGHT_COLORS.primary);
  });

  it('renders the empty editor shell when content is blank', () => {
    const html = createEditorHtml({
      colors: DARK_COLORS,
      content: '',
    });
    const document = new DOMParser().parseFromString(html, 'text/html');

    expect(document.getElementById('editor')?.innerHTML).toBe('');
    expect(html).toContain(DARK_COLORS.primary);
    expect(html).toContain('Start writing your story...');
  });

  it('preserves safe special characters in content', () => {
    const html = createEditorHtml({
      colors: LIGHT_COLORS,
      content: '<p>Fish &amp; Chips "Special"</p>',
    });
    const document = new DOMParser().parseFromString(html, 'text/html');

    expect(document.querySelector('p')?.textContent).toBe(
      'Fish & Chips "Special"'
    );
  });

  it('builds a theme update script without rebuilding the document shell', () => {
    const script = buildApplyEditorThemeScript(DARK_COLORS);

    expectValidJavaScript(script);
    expect(script).toContain('window.__baciApplyEditorTheme');
    expect(script).toContain(DARK_COLORS.background);
    expect(script).toContain(DARK_COLORS.border);
    expect(script).toContain(DARK_COLORS.card);
    expect(script).toContain(DARK_COLORS.primary);
    expect(script).toContain(DARK_COLORS.text);
    expect(script).toContain(DARK_COLORS.textMuted);
  });
});
