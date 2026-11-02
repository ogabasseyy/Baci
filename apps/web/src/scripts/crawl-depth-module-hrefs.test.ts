import { expect, it } from 'vitest';
import { collectModuleHrefs } from './crawl-depth-module-hrefs';

it('collects relative and same-origin hrefs without interpreting object labels', () => {
  expect(collectModuleHrefs({ title: '/not-a-link', items: [
    { href: '/one' }, 'two', { href: '//example.invalid/three' },
  ] })).toEqual(new Set(['/one', '/two']));
});

it('ignores fragment-only and query-only links without a known page', () => {
  expect(collectModuleHrefs(['#', '#section', '?page=2', '  #section', '  ?page=2'])).toEqual(new Set());
  expect(collectModuleHrefs(['/?page=2', '/products#details'])).toEqual(new Set(['/?page=2', '/products']));
});
