import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every enable flag must be read through piggyvest-switches so the master
// kill switch cannot be bypassed by a module that reads a flag directly.
const isSource = (name: string) =>
  name.endsWith('.ts') &&
  !/\.test(\.|-)/.test(name) &&
  !name.includes('.test-') &&
  name !== 'piggyvest-switches.ts';
const directRead = /\benv(?:ironment)?\s*(?:\.|\[\s*['"])PIGGYVEST_\w*_ENABLED/;

describe('no direct reads of PiggyVest enable flags', () => {
  it('only piggyvest-switches.ts reads *_ENABLED env vars', () => {
    const offenders = readdirSync(__dirname)
      .filter(isSource)
      .filter((file) =>
        directRead.test(readFileSync(join(__dirname, file), 'utf8'))
      );
    expect(offenders).toEqual([]);
  });
});
