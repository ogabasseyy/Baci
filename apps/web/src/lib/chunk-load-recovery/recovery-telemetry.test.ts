// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChunkRecoveryTelemetry,
  sendChunkRecoveryTelemetry,
} from './recovery-telemetry';

const TOKEN = 'phc_test_token';

const baseTelemetry: ChunkRecoveryTelemetry = {
  action: 'reload',
  failedAssetDeploymentId: 'deploy-old',
  failedAssetUrl: '/_next/static/chunks/app.js?dpl=deploy-old',
  pageDeploymentId: 'deploy-new',
  pathname: '/checkout',
  triggerSource: 'window-error',
};

function readBeaconPayload(sendBeacon: ReturnType<typeof vi.fn>) {
  const blob = sendBeacon.mock.calls[0][1] as Blob;
  return blob.text().then((text) => JSON.parse(text));
}

describe('sendChunkRecoveryTelemetry', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', TOKEN);
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROXY_PATH', '/baci-relay');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('posts a capture payload to the ingest proxy via sendBeacon', async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeacon,
    });

    sendChunkRecoveryTelemetry(baseTelemetry);

    expect(sendBeacon).toHaveBeenCalledWith('/baci-relay/e/', expect.any(Blob));
    const beaconBlob = sendBeacon.mock.calls[0][1] as Blob;
    expect(beaconBlob.type).toBe('text/plain');
    const payload = await readBeaconPayload(sendBeacon);
    expect(payload.api_key).toBe(TOKEN);
    expect(payload.event).toBe('chunk_load_recovery');
    expect(payload.distinct_id).toBeUndefined();
    expect(payload.properties.distinct_id).toMatch(/^chunk-recovery-/);
    expect(payload.properties).toMatchObject({
      deployment_id_match: false,
      failed_asset_deployment_id: 'deploy-old',
      failed_asset_url: '/_next/static/chunks/app.js?dpl=deploy-old',
      page_deployment_id: 'deploy-new',
      pathname: '/checkout',
      recovery_action: 'reload',
      trigger_source: 'window-error',
    });
  });

  it('reuses the persisted PostHog identity when available', async () => {
    window.localStorage.setItem(
      `ph_${TOKEN}_posthog`,
      JSON.stringify({
        $sesid: [1234567890, 'session-abc', 1234560000],
        distinct_id: 'known-user',
      })
    );
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeacon,
    });

    sendChunkRecoveryTelemetry(baseTelemetry);

    const payload = await readBeaconPayload(sendBeacon);
    expect(payload.distinct_id).toBeUndefined();
    expect(payload.properties.distinct_id).toBe('known-user');
    expect(payload.properties.$session_id).toBe('session-abc');
  });

  it('reports a null deployment match when the failed asset has no dpl', async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeacon,
    });

    sendChunkRecoveryTelemetry({
      ...baseTelemetry,
      failedAssetDeploymentId: null,
      failedAssetUrl: null,
    });

    const payload = await readBeaconPayload(sendBeacon);
    expect(payload.properties.deployment_id_match).toBeNull();
  });

  it('matches dpl-prefixed page deployment ids against raw asset dpls', async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeacon,
    });

    sendChunkRecoveryTelemetry({
      ...baseTelemetry,
      failedAssetDeploymentId: 'deploy-old',
      pageDeploymentId: 'dpl:deploy-old',
    });

    const payload = await readBeaconPayload(sendBeacon);
    expect(payload.properties.deployment_id_match).toBe(true);
    expect(payload.properties.page_deployment_id).toBe('dpl:deploy-old');
  });

  it('falls back to fetch keepalive when sendBeacon is unavailable', () => {
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: undefined,
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    sendChunkRecoveryTelemetry(baseTelemetry);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/baci-relay/e/',
      expect.objectContaining({
        headers: { 'Content-Type': 'text/plain' },
        keepalive: true,
        method: 'POST',
      })
    );
  });

  it('does nothing without a project token', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', '');
    const sendBeacon = vi.fn();
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeacon,
    });

    sendChunkRecoveryTelemetry(baseTelemetry);

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('does nothing outside a browser context', () => {
    const sendBeacon = vi.fn();
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeacon,
    });
    vi.stubGlobal('window', undefined);

    try {
      expect(() => sendChunkRecoveryTelemetry(baseTelemetry)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('never throws when the transport fails', () => {
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: () => {
        throw new Error('beacon blocked');
      },
    });

    expect(() => sendChunkRecoveryTelemetry(baseTelemetry)).not.toThrow();
  });

  it('does not throw or leave an unhandled rejection when the fetch fallback rejects', async () => {
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: undefined,
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network down'));

    expect(() => sendChunkRecoveryTelemetry(baseTelemetry)).not.toThrow();

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    // Flush the microtask queue so the rejected fetch promise's .catch()
    // handler (attached synchronously in the source) has a chance to run;
    // an unhandled rejection here would fail the test process.
    await Promise.resolve();
  });
});
