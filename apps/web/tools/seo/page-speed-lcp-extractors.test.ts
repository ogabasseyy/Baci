import { describe, expect, it } from 'vitest';
import {
  computeMedian,
  extractLcpSelector,
  extractLcpSubparts,
  isImageLcpNode,
  matchesExpectedSelector,
  resolveLcpResourceUrl,
} from './page-speed-lcp-extractors';

describe('page-speed-lcp-extractors', () => {
  it('computes medians for odd, even, and empty numeric arrays', () => {
    expect(computeMedian([])).toBeNull();
    expect(computeMedian([30, 10, 20])).toBe(20);
    expect(computeMedian([10, 20, 30, 40])).toBe(25);
  });

  it('detects image LCP nodes and matches terminal selector chains', () => {
    expect(isImageLcpNode('div > picture.block > img', null)).toBe(true);
    expect(isImageLcpNode('header > p.text-base', '<p>Copy</p>')).toBe(false);
    expect(
      matchesExpectedSelector('div.grid > picture.block > img', 'picture > img')
    ).toBe(true);
    expect(matchesExpectedSelector('header > div > p', 'header > p')).toBe(
      false
    );
  });

  it('extracts selector, subparts, and resource URL from Lighthouse audits', () => {
    const audits = {
      'lcp-breakdown-insight': {
        details: {
          items: [
            {
              items: [
                { duration: 90, subpart: 'timeToFirstByte' },
                { duration: 30, subpart: 'resourceLoadDelay' },
                { duration: 150, subpart: 'resourceLoadDuration' },
                { duration: 25, subpart: 'elementRenderDelay' },
              ],
              type: 'table',
            },
            {
              selector: 'div > picture > img',
              snippet: '<img src="https://cdn.ogabassey.com/hero…">',
              type: 'node',
            },
          ],
        },
      },
      'network-requests': {
        details: {
          items: [
            {
              networkRequestTime: 100,
              resourceType: 'Image',
              url: 'https://cdn.ogabassey.com/hero-mobile.avif',
            },
          ],
        },
      },
    };
    const node = extractLcpSelector(audits);
    expect(node.selector).toBe('div > picture > img');
    expect(extractLcpSubparts(audits)).toEqual({
      elementRenderDelayMs: 25,
      resourceLoadDelayMs: 30,
      resourceLoadDurationMs: 150,
      ttfbMs: 90,
    });
    expect(
      resolveLcpResourceUrl(audits, node.selector, node.snippet, 300)
    ).toBe('https://cdn.ogabassey.com/hero-mobile.avif');
  });
});
