import { z } from 'zod';
import { BRILSTASH_FEED_PATH, BRILSTASH_FULL_FEED_QUERY } from '../config/brilstash-feed';
import { createBrilStashToolClient } from '../lib/brilstash/cli-client';
import { readBrilStashCliInput } from '../lib/brilstash/cli-input';
import { verifyBrilStashFeed } from '../lib/brilstash/verify-feed';
import { brilStashProbeInputSchema } from '../schemas/brilstash-probe-input';
import { brilStashProbeStateSchema } from '../schemas/brilstash-probe-state';

async function main() {
  const { input, apply } = await readBrilStashCliInput(process.argv.slice(2));
  const parsed = brilStashProbeInputSchema.safeParse(input);
  const host = process.env.BRILSTASH_FEED_HOST;
  const bearer = process.env.BRILSTASH_FEED_BEARER;
  if (
    !parsed.success ||
    !host ||
    !/^[a-z0-9.-]+$/.test(host) ||
    !bearer ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(bearer)
  ) throw new Error('Invalid BrilStash probe configuration');

  const target = new URL(`https://${host}${BRILSTASH_FEED_PATH}`);
  for (const [name, value] of Object.entries(BRILSTASH_FULL_FEED_QUERY)) {
    target.searchParams.set(name, String(value));
  }
  const { installationId, expectedGenerationId, expectedPayloadDigest } = parsed.data;
  const client = await createBrilStashToolClient();
  const receipt = await verifyBrilStashFeed(target, bearer, {
    fetchFeed: fetch,
    readState: async () => {
      const { data, error } = await client.rpc('inspect_brilstash_probe_state', {
        p_installation_id: installationId,
      });
      const state = brilStashProbeStateSchema.safeParse(data);
      if (
        error ||
        !state.success ||
        state.data.installationId !== installationId ||
        state.data.generationId !== expectedGenerationId ||
        state.data.payloadDigest !== expectedPayloadDigest
      ) throw new Error('BrilStash probe state unavailable');
      return state.data;
    },
  });
  if (apply) {
    const { requestId, feedUrl, ...state } = receipt;
    const { data, error } = await client.rpc('record_brilstash_handoff_probe', {
      p_installation_id: installationId,
      p_state: state,
      p_request_id: requestId,
      p_feed_url: feedUrl,
    });
    const probeId = z.uuid().safeParse(data);
    if (error || !probeId.success) throw new Error('BrilStash probe record failed');
    process.stdout.write(`${JSON.stringify({ ...receipt, probeId: probeId.data })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

main().catch(() => {
  process.stderr.write('BrilStash feed verification failed\n');
  process.exitCode = 1;
});
