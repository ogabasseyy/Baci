import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Cancel to main and the reconcile/recovery passes must never depend on the
// master kill switch or on the gated new-work readers, or a kill would trap
// customers. Walk the full import graph of those entry points.
const srcRoot = join(__dirname, '..', '..');
const entries = [
  'cancel-plan.ts',
  'customer-cancel-handler.ts',
  'cancellation-recovery.ts',
  'collection-reconciliation.ts',
  // Cancel-with-refund to the main wallet (S6).
  'goal-cancel-runtime.ts',
  // Complete-to-main with a purchase request (S7).
  'goal-complete-runtime.ts',
];
const forbiddenModules = [
  'piggyvest-kill-switch',
  'piggyvest-feature-on',
  'piggyvest-feature-flags',
  'primary-wallet-runtime',
  'primary-wallet-savings-runtime',
  'primary-wallet-card-checkout-runtime',
  'primary-wallet-inflow-runtime',
];
const importSpecifier =
  /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;

function resolveModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(srcRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? join(dirname(from), specifier)
      : null;
  if (!base) return null;
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    base,
  ];
  return candidates.find((c) => /\.tsx?$/.test(c) && existsSync(c)) ?? null;
}

function reachable(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const text = readFileSync(file, 'utf8');
    seen.set(file, text);
    for (const match of text.matchAll(importSpecifier)) {
      const next = resolveModule(file, match[1]);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

describe('cancel to main and reconcile ignore the kill switch', () => {
  it.each(entries)('%s transitively avoids the gated readers', (file) => {
    const graph = reachable(join(__dirname, file));
    expect(graph.size).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const [path, text] of graph) {
      const name = relative(srcRoot, path);
      if (forbiddenModules.some((m) => path.endsWith(`/${m}.ts`)))
        offenders.push(`${name} is a gated module`);
      if (text.includes('PIGGYVEST_KILL_SWITCH'))
        offenders.push(`${name} reads the kill switch`);
    }
    expect(offenders).toEqual([]);
  });
});
