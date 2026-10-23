import { expect, it } from 'vitest';
import {
  associatedRuntimeTests,
  hasRuntimeBehavior,
} from './runtime-contract-test-coverage';
import { analyzeChangedRuntimeContracts } from './verify-analytics-delivery-authority';

it('recognizes runner qualifiers and TypeScript coverage of JavaScript without accepting another module', () => {
  const path = 'apps/web/tools/example/worker.mjs';
  const sources = new Map([
    ['apps/web/tools/example/worker.node.test.ts', 'test();'],
    ['apps/web/tools/example/other.test.mjs', 'test();'],
  ]);
  expect(associatedRuntimeTests(path, sources)).toEqual([
    'apps/web/tools/example/worker.node.test.ts',
  ]);
  expect(
    analyzeChangedRuntimeContracts(
      [path],
      new Map([...sources, [path, 'export function run() {}']])
    )
  ).toEqual([]);
});
it('requires a replacement when the last qualified test is removed', () => {
  const p = 'apps/web/src/lib/worker.ts';
  const t = 'apps/web/src/lib/worker.node.test.ts';
  const baseline = new Map([
    [p, 'export function run() {}'],
    [t, 'test();'],
  ]);
  expect(
    analyzeChangedRuntimeContracts(
      [p, t],
      new Map([[p, 'export function run() {}']]),
      baseline
    )
  ).toHaveLength(1);
});
it('exempts literal constants, types and barrels but preserves executable initialization', () => {
  expect(
    hasRuntimeBehavior(
      'x.ts',
      "export const flags = {enabled:false,items:[1,'a']} as const; export type X = string;"
    )
  ).toBe(false);
  for (const source of [
    'export const x = run();',
    'export const x = new Map();',
    'export const x = () => true;',
    'export const x = process.env.FLAG;',
    'sideEffect();',
    'export const {x = send()} = {};',
    'export const {[send()]: x} = {};',
  ])
    expect(hasRuntimeBehavior('x.ts', source)).toBe(true);
});
