import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ownerPreviewLaunchResponse } from '@/schemas/experience-owner-preview-response';
import { experiencePreviewInput } from '@/schemas/experience-preview';
import { OWNER_PREVIEW_CALL_TIMEOUT_MS } from './owner-preview-deadline';
import { RemoteOwnerPreviewDenied } from './owner-preview-remote-runtime';
import {
  productionDeliveryOrigins,
  productionOrigin,
} from './production-origins';
import { validateExperienceRoutes } from './route-ownership';

async function boundedJson(response: Response): Promise<unknown> {
  if (
    !response.body ||
    !response.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw Error('INVALID_OWNER_PREVIEW_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 262144) throw Error('INVALID_OWNER_PREVIEW_RESPONSE');
      chunks.push(item.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
  );
}

/** Trusted Baci server caller only; never exposes user tokens to the browser. */
export function createOwnerPreviewBridgeClient(settings: {
  key: Uint8Array;
  executionOrigin: string;
  now?: () => number;
  fetch: typeof fetch;
}) {
  if (settings.key.length !== 32 || typeof settings.fetch !== 'function')
    throw Error('INVALID_OWNER_BRIDGE_CONFIG');
  const key = Uint8Array.from(settings.key);
  const executionOrigin = productionOrigin(settings.executionOrigin);
  const now = settings.now ?? Date.now;
  return async (
    client: SupabaseClient,
    input: unknown,
    signal?: AbortSignal
  ) => {
    signal?.throwIfAborted();
    const session = await client.auth.getSession();
    signal?.throwIfAborted();
    const token = session.data.session?.access_token;
    if (
      session.error ||
      !token ||
      token.length > 8192 ||
      !/^[A-Za-z0-9_.-]+$/.test(token)
    )
      throw Error('OWNER_PREVIEW_UNAVAILABLE');
    const verified = await client.auth.getUser(token);
    signal?.throwIfAborted();
    if (verified.error || !verified.data.user)
      throw Error('OWNER_PREVIEW_UNAVAILABLE');
    const selection = experiencePreviewInput.parse(input);
    const body = JSON.stringify({
      version: 1,
      nonce: randomBytes(32).toString('hex'),
      expiresAt: now() + 30000,
      accessToken: token,
      input: selection,
    });
    const signature = createHmac('sha256', key)
      .update(`owner-preview/v1\n${body}`)
      .digest('hex');
    const timeout = AbortSignal.timeout(OWNER_PREVIEW_CALL_TIMEOUT_MS);
    const response = await settings.fetch(
      'https://owner.baci-internal.invalid/internal/owner/preview',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-baci-owner-signature': signature,
        },
        body,
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      }
    );
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 404) throw new RemoteOwnerPreviewDenied();
      throw Error('OWNER_PREVIEW_UNAVAILABLE');
    }
    const launch = ownerPreviewLaunchResponse.parse(
      await boundedJson(response)
    );
    const src = new URL(launch.src);
    const canonical = new URL(launch.canonicalBase);
    productionDeliveryOrigins({
      executionOrigin,
      hostOrigins: [productionOrigin(canonical.origin)],
    });
    if (
      launch.merchantId !== selection.merchantId ||
      launch.expiresAt <= now() ||
      launch.expiresAt > now() + 605000 ||
      src.origin !== executionOrigin ||
      src.username ||
      src.password ||
      src.search ||
      src.hash ||
      !/^\/resource\/[a-f0-9]{64}\/index\.html$/.test(src.pathname) ||
      canonical.username ||
      canonical.password ||
      canonical.search ||
      canonical.hash
    )
      throw Error('INVALID_OWNER_PREVIEW_RESPONSE');
    validateExperienceRoutes(launch.routes);
    for (const asset of Object.values(launch.bootstrap.assets ?? {})) {
      const url = new URL(asset);
      if (
        url.origin !== executionOrigin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/resource\/[a-f0-9]{64}\/assets\/[a-z0-9-]{1,80}$/.test(
          url.pathname
        )
      )
        throw Error('INVALID_OWNER_PREVIEW_RESPONSE');
    }
    return launch;
  };
}
