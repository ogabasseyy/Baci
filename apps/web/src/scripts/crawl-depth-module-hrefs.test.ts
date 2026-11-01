import { expect, it } from 'vitest';
import { collectModuleHrefs } from './crawl-depth-module-hrefs';

it('collects relative and same-origin hrefs without interpreting object labels', () => {
  expect(collectModuleHrefs({ title: '/not-a-link', items: [
    { href: '/one' }, 'two', { href: '//example.invalid/three' },
  ] })).toEqual(new Set(['/one', '/two']));
});
