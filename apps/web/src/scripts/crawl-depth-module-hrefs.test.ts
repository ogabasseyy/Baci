import { expect, it } from 'vitest';
import { collectModuleHrefs } from './crawl-depth-module-hrefs';

it('collects relative and same-origin hrefs without interpreting object labels', () => {
  expect(collectModuleHrefs({ title: '/not-a-link', items: [
    { href: '/one' }, 'two', { href: '//example.invalid/three' },
  ] })).toEqual(new Set(['/one']));
});

it('ignores text arrays while retaining explicit link lists and href fields', () => {
  expect(collectModuleHrefs({ tags: ['/false-positive'], hrefs: ['/valid'], modules: [{ href: '/item' }] })).toEqual(new Set(['/valid', '/item']));
  expect(collectModuleHrefs(['/root-list'])).toEqual(new Set(['/root-list']));
});

it('handles cycles and deeply nested data without overflowing', () => {
  const cycle: { href: string; next?: unknown } = { href: '/one' };
  cycle.next = cycle;
  let nested: unknown = cycle;
  for (let i = 0; i < 12000; i++) nested = { child: nested };
  expect(collectModuleHrefs(nested)).toEqual(new Set(['/one']));
});

it('ignores fragment-only and query-only links without a known page', () => {
  expect(collectModuleHrefs(['#', '#section', '?page=2', '  #section', '  ?page=2'])).toEqual(new Set());
  expect(collectModuleHrefs(['/?page=2', '/products#details'])).toEqual(new Set(['/?page=2', '/products']));
});
