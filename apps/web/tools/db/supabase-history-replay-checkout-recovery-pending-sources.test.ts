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
  {
    filename:
      '20261015130721_customer_checkout_shipping_recovery_delivery_boundary.sql',
    sha256: '1c411255bf10472a71c0f38a2b744d246764453832b7a6e32091a72226f8ac6b',
  },
  {
    filename:
      '20261015145945_customer_checkout_shipping_recovery_committed_retry.sql',
    sha256: '6336d903431424e3824ab52afa21213eeeac968406b519cc8bdd0f1944734627',
  },
  {
    filename:
      '20261015215000_customer_checkout_shipping_recovery_activation_gate.sql',
    sha256: 'e5fc8805f5f1364473aea7bd954eeb909c20e2fff8d9e39d36137b3d0961e0ad',
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
