import { describe, expect, it } from 'vitest';
import { codecProblems } from './merchant-image-pilot-codec-smoke.mjs';

function valid() {
  return {
    capabilities: { avif: false, webp: true },
    state: {
      hydrated: true,
      interactive: true,
      unchanged: true,
      sources: 2,
      currentSrc: 'http://127.0.0.1:1234/fallback.webp',
      naturalWidth: 48,
    },
    requests: ['/fallback.webp'],
    errors: [],
    failures: [],
  };
}

describe('native no-AVIF fixture verdict', () => {
  it('accepts native unsupported AVIF with a hydrated, decoded WebP fallback', () => {
    expect(codecProblems(valid())).toEqual([]);
  });
  it('rejects a browser which actually decodes AVIF', () => {
    const result = valid();
    result.capabilities.avif = true;
    expect(codecProblems(result)).toContain('AVIF decoding is supported');
  });
  it('rejects the observed WebP selection plus AVIF preload download', () => {
    const result = valid();
    result.requests.push('/hero.avif');
    expect(codecProblems(result)).toContain('AVIF was requested');
  });
  it.each([
    'hydrated',
    'interactive',
    'unchanged',
  ])('rejects failed %s proof', (key) => {
    const result = valid();
    result.state[key] = false;
    expect(codecProblems(result).length).toBeGreaterThan(0);
  });
  it.each([
    ['sources', 1],
    ['naturalWidth', 0],
    ['currentSrc', 'http://127.0.0.1/hero.avif'],
  ])('rejects invalid image state %s', (key, value) => {
    const result = valid();
    result.state[key] = value;
    expect(codecProblems(result).length).toBeGreaterThan(0);
  });
  it('requires a real WebP fetch, not only currentSrc', () => {
    const result = valid();
    result.requests = [];
    expect(codecProblems(result)).toContain('WebP was not requested');
  });
  it('rejects decoder failure and console/network errors', () => {
    const result = valid();
    result.capabilities.webp = false;
    result.errors.push('hydration mismatch');
    result.failures.push('404');
    expect(codecProblems(result)).toHaveLength(3);
  });
  it('fails closed on missing evidence', () => {
    expect(codecProblems({}).length).toBeGreaterThan(0);
  });
});
