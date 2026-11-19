import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  binDir,
  C1,
  C2,
  docsDir,
  M,
  startScratch,
  W1,
  W2,
  W3,
  W4,
} from './piggyvest-legacy-runbook.db-support';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;

describe('piggyvest legacy runbook db support', () => {
  it('exports distinct, valid fixture ids', () => {
    const ids = [W1, W2, W3, W4, M, C1, C2];
    for (const id of ids) expect(id).toMatch(UUID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points docsDir at the legacy migration SQL folder', () => {
    expect(existsSync(join(docsDir, '01-balance-list.sql'))).toBe(true);
    expect(existsSync(join(docsDir, '02-zero-out.sql'))).toBe(true);
  });

  it('resolves binDir to a folder holding initdb, or undefined', () => {
    if (binDir) expect(existsSync(join(binDir, 'initdb'))).toBe(true);
    else expect(binDir).toBeUndefined();
  });

  it.skipIf(!binDir)(
    'starts a scratch database with the wallet tables and stops cleanly',
    async () => {
      const scratch = startScratch();
      try {
        const res = scratch.psql(
          "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('customer_wallets','customer_wallet_transactions','customers')"
        );
        expect(res.status).toBe(0);
        expect(res.stdout.trim()).toBe('3');
        const file = join(scratch.dir, 'one.sql');
        writeFileSync(file, 'SELECT 1 / 0;');
        const failed = await scratch.psqlFileAsync(file);
        expect(failed.status).not.toBe(0);
        expect(failed.stderr).toMatch(/division by zero/);
      } finally {
        scratch.stop();
      }
      expect(existsSync(scratch.dir)).toBe(false);
    },
    60_000
  );
});
