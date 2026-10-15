import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_TAIL_SOURCES } from './expected-pending-tail-sources.test-fixture';
import { CHECKOUT_RECOVERY_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-checkout-recovery-pending-sources';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

const sources = [
  {
    filename:
      '20261015115210_customer_checkout_shipping_recovery_acl_and_redaction_index.sql',
    sha256: 'c447cf6614df344591430a14df91201ae5404b1c6413e59d307205ec66641225',
  },
  {
    filename:
      '20261015124602_customer_checkout_shipping_recovery_address_aliases.sql',
    sha256: '6c4e56759fea25200a28a748a848c9da213550bc678e47ba9fe7a2727823188c',
  },
];

describe('checkout recovery repair replay registration', () => {
  it.each(
    sources
  )('registers $filename exactly once as pending, never as production or post-replay', async ({
    filename,
    sha256,
  }) => {
    const source = {
      repositoryPath: `supabase/migrations/${filename}`,
      sha256,
    };
    const manifest = supabaseHistoryReplayManifest;
    expect(
      manifest.pendingSources.filter(
        (entry) => entry.repositoryPath === source.repositoryPath
      )
    ).toEqual([source]);
    expect(
      EXPECTED_PENDING_TAIL_SOURCES.recent.filter(
        (entry) => entry.repositoryPath === source.repositoryPath
      )
    ).toEqual([source]);
    expect(CHECKOUT_RECOVERY_PENDING_REPLAY_SOURCE_ROWS.split('\n')).toContain(
      `${source.sha256} ${filename}`
    );
    const bytes = await readFile(
      resolve(__dirname, '../../../..', source.repositoryPath)
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      source.sha256
    );
    expect(
      manifest.postReplaySources.some(
        (entry) => entry.repositoryPath === source.repositoryPath
      )
    ).toBe(false);
    expect(
      manifest.productionMappings.some(
        (entry) => entry.repositoryPath === source.repositoryPath
      )
    ).toBe(false);
  });
});
