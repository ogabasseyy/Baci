import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginResponseWithoutCustomerType } from './gigl.test-helpers';

describe('tracking token reuse across invocations', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('logs in once across two batches and reauthenticates after credential rotation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gigl-integration-'));
    vi.stubEnv('GIGL_BASE_URL', 'https://gigl.example.test');
    vi.stubEnv('GIGL_EMAIL', 'synthetic@example.test');
    vi.stubEnv('GIGL_PASSWORD', 'synthetic-password');
    vi.resetModules();
    try {
      const { GiglApiClient } = await import('./gigl.auth');
      const { createGiglTrackingTokenCache } = await import(
        './gigl-tracking-token-cache'
      );
      const { runWithGiglTrackingTokenCache } = await import(
        './gigl-tracking-cache-runner'
      );
      const safeFetch = vi.fn(
        async () =>
          new Response(JSON.stringify(loginResponseWithoutCustomerType), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      );
      const log = vi.fn();
      const credentials = {
        baseUrl: 'https://gigl.example.test',
        email: 'synthetic@example.test',
        password: 'synthetic-password',
      };
      const invoke = (password: string) =>
        runWithGiglTrackingTokenCache({
          cache: createGiglTrackingTokenCache({
            directory: join(root, 'cache'),
            credentials: { ...credentials, password },
          }),
          createProvider: (initial) =>
            new GiglApiClient({ safeFetch, log }, initial),
          run: (client) => client.getApiToken(),
        });
      await invoke(credentials.password);
      await invoke(credentials.password);
      expect(safeFetch).toHaveBeenCalledTimes(1);
      await invoke('rotated-password');
      expect(safeFetch).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(log.mock.calls)).not.toContain('test-access-token');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
