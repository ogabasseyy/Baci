import { expect, it } from 'vitest';
import { configureCatalogWidgetHtml } from './catalog-widget-html';

it('sets browse-only mode without dropping the legacy host marker', () => {
  const html = '<!doctype html><html lang="en"><body></body></html>';
  expect(configureCatalogWidgetHtml(html, false)).toBe(html);
  expect(configureCatalogWidgetHtml(html, true, true)).toContain(
    '<html data-ogabassey-catalog-only="true" data-ogabassey-legacy-widget="true" lang="en">'
  );
});

it('preserves the original tag case and rejects fragments in catalog-only mode', () => {
  expect(configureCatalogWidgetHtml('<HTML lang="en"></HTML>', true)).toBe(
    '<HTML data-ogabassey-catalog-only="true" lang="en"></HTML>'
  );
  expect(() => configureCatalogWidgetHtml('<section></section>', true)).toThrow();
});

it('fails closed when only comment text contains an HTML opening tag', () => {
  expect(() => configureCatalogWidgetHtml('<!-- <html> --><section></section>', true)).toThrow();
});
