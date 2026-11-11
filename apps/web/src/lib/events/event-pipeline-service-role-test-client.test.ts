// @vitest-environment jsdom

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const modulePath = resolve(
  process.cwd(),
  'src/lib/events/event-pipeline-service-role-test-client.ts'
);
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

describe('event pipeline service-role test client', () => {
  it('fails closed outside the test runtime', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { createEventPipelineServiceRoleTestClient } = await import(
      /* @vite-ignore */ pathToFileURL(modulePath).href
    );
    expect(() => createEventPipelineServiceRoleTestClient(vi.fn())).toThrow(
      'test-only'
    );
  });

  it('delegates branding to the production sentinel factory', async () => {
    expect(existsSync(modulePath), 'service-role test client is missing').toBe(
      true
    );
    if (!existsSync(modulePath)) return;
    const moduleUrl = pathToFileURL(modulePath).href;
    const { createEventPipelineServiceRoleTestClient } = await import(
      /* @vite-ignore */ moduleUrl
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json([]));
    const client = createEventPipelineServiceRoleTestClient(fetch);
    const result = await client.from('orders').select('id');
    expect(result.error).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('surfaces a non-2xx PostgREST response', async () => {
    const { createEventPipelineServiceRoleTestClient } = await import(
      /* @vite-ignore */ pathToFileURL(modulePath).href
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        { code: 'PGRST301', message: 'permission denied' },
        { status: 403 }
      )
    );
    const result = await createEventPipelineServiceRoleTestClient(fetch)
      .from('orders')
      .select('id');
    expect(result.error).toMatchObject({ message: 'permission denied' });
  });
});
