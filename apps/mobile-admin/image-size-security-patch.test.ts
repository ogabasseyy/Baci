import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('image parser dependency security', () => {
  it('does not reintroduce the removed image-size dependency with unbounded parser loops', () => {
    const lockfile = readFileSync(
      resolve(__dirname, '../../pnpm-lock.yaml'),
      'utf8'
    );
    expect(lockfile).not.toMatch(/^ {2}image-size@/m);
  });
});
