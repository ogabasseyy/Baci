import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('attempts route module shape', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/app/api/payments/oxygen/attempts/route.ts'),
    'utf8'
  );
  it('performs no DB writes and reads no env', () => {
    expect(source).not.toMatch(/\b(insert|upsert|update|delete|rpc)\b/);
    expect(source).not.toContain('process.env');
  });
  it('restricts oxygen imports to the two S-05 routes and test files', () => {
    // Repo-wide wiring gate (F1): fails if any third file imports an oxygen
    // module. This test file matches the pattern below and is exempt as a
    // *.test.ts file by construction.
    const srcRoot = resolve(process.cwd(), 'src');
    const roots = [srcRoot];
    const offenders: string[] = [];
    const oxygenImport =
      /oxygen\/(availability|context|initiation)|oxygen-requests/;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        // Exemptions depend only on the path, so exempt files are skipped
        // before reading: identical offenders list, fewer file reads.
        const relative = full.replace(`${srcRoot}/`, '');
        const isS05Route =
          relative === 'app/api/payments/oxygen/attempts/route.ts' ||
          relative === 'app/api/payments/oxygen/availability/route.ts';
        const isTest = /\.test\.tsx?$/.test(entry.name);
        if (isS05Route || isTest) continue;
        if (!oxygenImport.test(readFileSync(full, 'utf8'))) continue;
        offenders.push(relative);
      }
    };
    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
    // The walk reads thousands of files; allow headroom on loaded machines.
    // The offenders assertion above is unchanged.
  }, 60_000);
});
