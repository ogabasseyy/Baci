/** @vitest-environment node */
import type sanitizeHtml from 'sanitize-html';
import { describe, expect, it } from 'vitest';
import { findInstalledRoots } from './security-integrity-find-installed-roots';
import { loadCjs } from './security-integrity-load-cjs';

describe('sanitize-html discarded iframe security boundary', () => {
  const roots = findInstalledRoots('sanitize-html');
  it('finds installed sanitizers to guard', () => {
    expect(roots.length).toBeGreaterThan(0);
  });
  for (const root of roots) {
    const sanitize = loadCjs(root) as typeof sanitizeHtml;
    it(`handles deeply repeated unclosed iframe fallbacks in ${root}`, () => {
      for (const opener of [
        '<iframe>',
        '<IFRAME>',
        '<iframe src="about:blank">',
      ]) {
        const output = sanitize(opener.repeat(4_000));
        expect(output).not.toContain('<');
        expect(output).not.toContain('>');
      }
    });
    it(`enforces nestingLimit across discarded iframe fallbacks in ${root}`, () => {
      const output = sanitize(`${'<iframe><b><b><b>'.repeat(50)}x`, {
        allowedTags: ['b'],
        nestingLimit: 3,
      });
      let depth = 0;
      let maximumDepth = 0;
      for (const tag of output.matchAll(/<\/?b>/g)) {
        depth += tag[0] === '<b>' ? 1 : -1;
        maximumDepth = Math.max(maximumDepth, depth);
      }
      expect(maximumDepth).toBeLessThanOrEqual(3);
    });
    it(`preserves legitimate formatting and rejects executable content in ${root}`, () => {
      expect(sanitize('<iframe><b>fallback</b></iframe><p>after</p>')).toBe(
        '<b>fallback</b><p>after</p>'
      );
      expect(sanitize('<p>Hello <b>world</b></p>')).toBe(
        '<p>Hello <b>world</b></p>'
      );
      expect(sanitize('<a href="javascript:alert(1)">Link</a>')).toBe(
        '<a>Link</a>'
      );
    });
  }
});
