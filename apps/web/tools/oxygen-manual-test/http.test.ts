// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { handleProbeRequest } from './http';
import { OxygenProbe } from './session';

const origin = 'http://127.0.0.1:3417';
const config = {
  origin,
  csrf: 'test-csrf',
  environment: 'production' as const,
  configured: false,
};
const probe = new OxygenProbe(
  {
    baseUrl: 'https://api.oxygenx.africa/services/partners',
    environment: 'production',
    reference: '',
    secret: '',
  },
  vi.fn()
);
describe('loopback manual UI boundary', () => {
  it('renders production and consent controls without credentials', async () => {
    const response = await handleProbeRequest(
      new Request(origin),
      probe,
      config
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('PRODUCTION');
    expect(html).toContain('I am submitting my own details');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it.each([
    'http://evil.example',
    'null',
  ])('rejects foreign origin %s before provider access', async (foreign) => {
    const response = await handleProbeRequest(
      new Request(`${origin}/action`, {
        method: 'POST',
        headers: { origin: foreign, 'x-probe-csrf': 'test-csrf' },
        body: JSON.stringify({ action: 'login' }),
      }),
      probe,
      config
    );
    expect(response.status).toBe(403);
  });
  it('rejects DNS rebinding host and missing CSRF', async () => {
    expect(
      (
        await handleProbeRequest(
          new Request('http://evil.example:3417/'),
          probe,
          config
        )
      ).status
    ).toBe(403);
    expect(
      (
        await handleProbeRequest(
          new Request(`${origin}/action`, {
            method: 'POST',
            headers: { origin },
            body: '{}',
          }),
          probe,
          config
        )
      ).status
    ).toBe(403);
  });
  it('does not support financial booking or activation actions', async () => {
    const response = await handleProbeRequest(
      new Request(`${origin}/action`, {
        method: 'POST',
        headers: { origin, 'x-probe-csrf': 'test-csrf' },
        body: JSON.stringify({ action: 'activate' }),
      }),
      probe,
      config
    );
    expect(response.status).toBe(400);
  });
});

it('serves browser controls even when launched from a different directory', async () => {
  const previous = process.cwd();
  try {
    process.chdir('/tmp');
    const response = await handleProbeRequest(
      new Request(`${origin}/client.js`),
      probe,
      config
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("fetch('/action'");
  } finally {
    process.chdir(previous);
  }
});
