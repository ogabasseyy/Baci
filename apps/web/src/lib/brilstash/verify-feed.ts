import { z } from 'zod';
import {
  type BrilStashProbeState,
  brilStashProbeStateSchema,
} from '../../schemas/brilstash-probe-state';
import { digestBrilStashPayload } from './catalogue-snapshot';
import { createBrilStashPageProof } from './page-proof';

const failure = 'BrilStash feed verification failed';

async function readFeedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(failure);

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) throw new Error(failure);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel();
  }
}

export async function verifyBrilStashFeed(
  target: URL,
  bearer: string,
  dependencies: {
    readState: () => Promise<BrilStashProbeState>;
    fetchFeed: typeof fetch;
  }
) {
  try {
    const before = brilStashProbeStateSchema.parse(
      await dependencies.readState()
    );
    const response = await dependencies.fetchFeed(target, {
      redirect: 'error',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(10000),
    });
    const requestId = z.uuid().parse(response.headers.get('X-Request-Id'));
    if (
      response.status !== 200 ||
      response.headers.get('X-Total-Pages') !== '1' ||
      response.headers.get('X-Total-Count') !== String(before.totalCount) ||
      response.headers.get('X-Baci-Catalogue-Proof') !==
        createBrilStashPageProof(requestId, before)
    ) {
      await response.body?.cancel();
      throw new Error(failure);
    }

    const payload = await readFeedJson(response);
    if (
      !Array.isArray(payload) ||
      payload.length !== before.totalCount ||
      digestBrilStashPayload(payload) !== before.payloadDigest
    ) {
      throw new Error(failure);
    }

    const after = brilStashProbeStateSchema.parse(
      await dependencies.readState()
    );
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error(failure);
    return { ...after, requestId, feedUrl: target.href };
  } catch {
    throw new Error(failure);
  }
}
