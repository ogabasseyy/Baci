import { expect, it } from 'vitest';
import { configureCatalogWidgetHtml } from './catalog-widget-html';

it('sets browse-only mode without dropping the legacy host marker', () => {
  const html = '<!doctype html><html lang="en"><body></body></html>';
  expect(configureCatalogWidgetHtml(html, false)).toBe(html);
  expect(configureCatalogWidgetHtml(html, true, true)).toContain(
    '<html data-ogabassey-catalog-only="true" data-ogabassey-legacy-widget="true" lang="en">'
  );
});
