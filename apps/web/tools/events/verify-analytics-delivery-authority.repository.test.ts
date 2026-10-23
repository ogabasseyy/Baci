import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeChangedRuntimeContracts,
  baselineSources,
  changedPaths,
  verifyAnalyticsDeliveryAuthority,
} from './verify-analytics-delivery-authority';

describe('analytics delivery authority repository contract', () => {
  it('enforces changed runtime size and colocated tests', () => {
    const good = 'apps/web/src/lib/analytics/good.ts';
    const oversized = 'apps/web/src/lib/analytics/oversized-provider.ts';
    const sources = new Map([
      [good, 'export const good = () => true;'],
      ['apps/web/src/lib/analytics/good.test.ts', 'test();'],
      [oversized, `${'// line\n'.repeat(301)}export const send = () => true;`],
    ]);
    expect(analyzeChangedRuntimeContracts([good, oversized], sources)).toEqual([
      `${oversized}: changed runtime exceeds 300 lines`,
      `${oversized}: changed runtime is missing colocated test apps/web/src/lib/analytics/oversized-provider.test.ts`,
    ]);
  });

  it('counts an unterminated 301st runtime line', () => {
    const path = 'apps/web/src/lib/analytics/unterminated.ts';
    const sources = new Map([
      [path, Array.from({ length: 301 }, () => 'export {};').join('\n')],
      ['apps/web/src/lib/analytics/unterminated.test.ts', 'export {};'],
    ]);
    expect(analyzeChangedRuntimeContracts([path], sources)).toContain(
      `${path}: changed runtime exceeds 300 lines`
    );
  });

  it('grandfathers existing oversized runtime and existing test topology', () => {
    const path = 'apps/web/src/app/checkout/page.tsx';
    const testPath = 'apps/web/src/app/checkout/page.test.tsx';
    const current = `${'// current\n'.repeat(350)}run();`;
    const baseline = `${'// baseline\n'.repeat(340)}run();`;
    expect(
      analyzeChangedRuntimeContracts(
        [path],
        new Map([
          [path, current],
          [testPath, 'test();'],
        ]),
        new Map([
          [path, baseline],
          [testPath, 'test();'],
        ])
      )
    ).toEqual([]);
  });

  it('grandfathers an existing runtime that already lacked a test', () => {
    const path = 'apps/web/src/app/checkout/page.tsx';
    const current = new Map([[path, 'run();']]);
    const baseline = new Map([[path, 'run();']]);

    expect(analyzeChangedRuntimeContracts([path], current, baseline)).toEqual(
      []
    );
  });

  it('rejects deleting the test for an existing runtime', () => {
    const path = 'apps/web/src/app/checkout/page.tsx';
    const testPath = 'apps/web/src/app/checkout/page.test.tsx';
    const current = new Map([[path, 'run();']]);
    const baseline = new Map([
      [path, 'run();'],
      [testPath, 'test();'],
    ]);

    expect(
      analyzeChangedRuntimeContracts([testPath], current, baseline)
    ).toEqual([
      `${path}: changed runtime is missing colocated test ${testPath}`,
    ]);
  });

  it('still rejects a legacy file that crosses the 300-line boundary', () => {
    const path = 'apps/web/src/lib/analytics/provider.ts';
    const current = `${'// current\n'.repeat(301)}run();`;
    const baseline = `${'// baseline\n'.repeat(299)}run();`;
    expect(
      analyzeChangedRuntimeContracts(
        [path],
        new Map([
          [path, current],
          ['apps/web/src/lib/analytics/provider.test.ts', 'test();'],
        ]),
        new Map([[path, baseline]])
      )
    ).toContain(`${path}: changed runtime exceeds 300 lines`);
  });

  it.each([
    'mts',
    'cts',
  ])('requires colocated tests for .%s runtime files', (extension) => {
    const path = `apps/web/src/lib/analytics/provider.${extension}`;
    expect(
      analyzeChangedRuntimeContracts(
        [path],
        new Map([[path, 'export const provider = () => true;']])
      )
    ).toEqual([
      `${path}: changed runtime is missing colocated test apps/web/src/lib/analytics/provider.test.${extension}`,
    ]);
  });

  it('fails closed when the PR merge base cannot be resolved', () => {
    expect(() =>
      changedPaths('/repo', (args) => {
        if (args[0] === 'merge-base') throw new Error('missing base');
        return '';
      })
    ).toThrow('missing base');
  });

  it('parses changed source paths with NUL delimiters', () => {
    const changed = 'apps/web/src/lib/events/line\nbreak.ts';
    expect(
      changedPaths('/repo', (args) => {
        if (args[0] === 'merge-base') return 'abc123\n';
        if (args[0] === 'diff' && args.includes('abc123...HEAD')) {
          expect(args).toContain('-z');
          return `${changed}\0`;
        }
        if (args[0] === 'diff') return 'apps/web/src/other.ts\0';
        if (args[0] === 'ls-files') return `${changed}\0`;
        return '';
      })
    ).toEqual([changed, 'apps/web/src/other.ts']);
  });

  it('loads only paths that existed at the merge base', () => {
    const showCalls: string[] = [];
    expect(
      baselineSources(
        '/repo',
        ['existing.ts', 'added.ts', 'existing.ts'],
        (args) => {
          if (args[0] === 'merge-base') return 'abc123\n';
          showCalls.push(args[1] ?? '');
          if (args[0] === 'show' && args[1] === 'abc123:existing.ts') {
            return 'export const existing = true;';
          }
          throw Object.assign(new Error('missing path'), {
            stderr: "fatal: path 'added.ts' does not exist in 'abc123'\n",
          });
        }
      )
    ).toEqual(new Map([['existing.ts', 'export const existing = true;']]));
    expect(showCalls).toEqual(['abc123:existing.ts', 'abc123:added.ts']);
  });

  it('propagates unexpected baseline repository failures', () => {
    expect(() =>
      baselineSources('/repo', ['existing.ts'], (args) => {
        if (args[0] === 'merge-base') return 'abc123\n';
        throw Object.assign(new Error('repository unavailable'), {
          stderr: 'fatal: not a git repository\n',
        });
      })
    ).toThrow('repository unavailable');
  });

  it('passes the live repository authority contract', () => {
    expect(
      verifyAnalyticsDeliveryAuthority(resolve(process.cwd(), '../..'))
    ).toEqual([]);
  }, 480_000);
});
