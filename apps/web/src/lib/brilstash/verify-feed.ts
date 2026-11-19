import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  BRILSTASH_FEED_PROBE_TIMEOUT_MS,
  BRILSTASH_FULL_FEED_QUERY,
  BRILSTASH_JSON_MAX_BYTES,
} from '../../config/brilstash-feed';
import {
  type BrilStashProbeState,
  brilStashProbeStateSchema,
} from '../../schemas/brilstash-probe-state';
import { digestBrilStashPayload } from './catalogue-snapshot';
import { createBrilStashPageCorrelation } from './page-correlation';

const failure = 'BrilStash feed verification failed';

async function readFeedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(failure);

  const chunks: Uint8Array[] = [];
  let size = 0;
  let drained = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        drained = true;
        break;
      }
      size += value.byteLength;
      if (size > BRILSTASH_JSON_MAX_BYTES) throw new Error(failure);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    if (!drained) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
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
      signal: AbortSignal.timeout(BRILSTASH_FEED_PROBE_TIMEOUT_MS),
    });
    const requestId = z.uuid().parse(response.headers.get('X-Request-Id'));
    const expectedPages = Math.ceil(
      before.totalCount / BRILSTASH_FULL_FEED_QUERY.limit
    );
    if (
      response.status !== 200 ||
      expectedPages !== 1 ||
      response.headers.get('X-Total-Pages') !== String(expectedPages) ||
      response.headers.get('X-Total-Count') !== String(before.totalCount) ||
      response.headers.get('X-Baci-Catalogue-Correlation') !==
        createBrilStashPageCorrelation(requestId, before)
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
    if (!isDeepStrictEqual(before, after)) throw new Error(failure);
    return { ...after, requestId, feedUrl: target.href };
  } catch {
    throw new Error(failure);
  }
}
