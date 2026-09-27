import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import registrationHandler from './registration-handler';

function invoke(
  method = 'GET',
  url = '/api/webhooks/piggyvest',
  signature?: string
) {
  const request = new IncomingMessage(new Socket());
  request.method = method;
  request.url = url;
  if (signature !== undefined) request.headers['x-pvb-signature'] = signature;
  const response = new ServerResponse(request);
  const end = vi.spyOn(response, 'end').mockReturnValue(response);
  const readBody = vi.spyOn(request, 'read');
  registrationHandler(request, response);
  return { response, end, readBody };
}

beforeEach(() => {
  vi.stubEnv('PVB_STAGING_REGISTRATION_PROJECT_ID', 'prj_synthetic_staging');
  vi.stubEnv('VERCEL_PROJECT_ID', 'prj_synthetic_staging');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('PVB_INTEGRATION_ENV', 'staging');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('isolated PiggyVest registration endpoint', () => {
  it('supports provider registration while clearly reporting processing disabled', () => {
    const { response, end } = invoke();
    expect(response.statusCode).toBe(200);
    expect(end).toHaveBeenCalledWith(
      JSON.stringify({
        status: 'registration_ready',
        environment: 'staging',
        eventProcessing: 'disabled',
      })
    );
    expect(response.getHeader('Cache-Control')).toBe('no-store');
    expect(response.getHeader('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('supports a bodyless HEAD probe', () => {
    const { response, end } = invoke('HEAD');
    expect(response.statusCode).toBe(200);
    expect(end).toHaveBeenCalledWith(undefined);
  });

  it('returns 200 for unsigned profiling POST without reading or processing events', () => {
    const { response, readBody, end } = invoke('POST');
    expect(response.statusCode).toBe(200);
    expect(readBody).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledWith('OK');
    expect(response.getHeader('Cache-Control')).toBe('no-store');
  });

  it('acknowledges the forwarded test ping without trusting Hookdeck verification headers', () => {
    const request = new IncomingMessage(new Socket());
    request.method = 'POST';
    request.url = '/api/webhooks/piggyvest';
    request.headers = {
      'content-type': 'application/json',
      'idempotency-key': 'evt_synthetic_ping',
      'x-hookdeck-signature': 'synthetic-untrusted-signature',
      'x-hookdeck-verified': 'false',
      'x-hookdeck-eventid': 'evt_synthetic_ping',
    };
    request.push(Buffer.from(JSON.stringify({ test: 'ping' })));
    request.push(null);
    const response = new ServerResponse(request);
    const end = vi.spyOn(response, 'end').mockReturnValue(response);
    const readBody = vi.spyOn(request, 'read');

    registrationHandler(request, response);

    expect(response.statusCode).toBe(200);
    expect(end).toHaveBeenCalledWith('OK');
    expect(readBody).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'synthetic-invalid',
    'a'.repeat(128),
  ])('does not acknowledge signed delivery %s before credentials and durable ingestion exist', (signature) => {
    const { response, readBody, end } = invoke('POST', undefined, signature);
    expect(response.statusCode).toBe(503);
    expect(readBody).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledWith(
      JSON.stringify({
        error: 'Webhook processing is not configured',
        code: 'PIGGYVEST_NOT_READY',
      })
    );
  });

  it('does not enable event acceptance when a secret is accidentally provisioned', () => {
    vi.stubEnv('PVB_SECRET_KEY', 'synthetic-test-secret');
    expect(invoke('POST', undefined, 'a'.repeat(128)).response.statusCode).toBe(
      503
    );
  });

  it.each([
    ['PVB_STAGING_REGISTRATION_PROJECT_ID', undefined],
    ['VERCEL_PROJECT_ID', 'prj_other_project'],
    ['VERCEL_ENV', 'preview'],
    ['PVB_INTEGRATION_ENV', 'production'],
  ])('fails closed with invalid %s', (name, value) => {
    vi.stubEnv(name, value);
    expect(invoke().response.statusCode).toBe(503);
    expect(invoke('POST').response.statusCode).toBe(503);
  });

  it('does not expose other application paths', () => {
    expect(invoke('GET', '/api/orders').response.statusCode).toBe(404);
  });

  it('rejects unsupported methods', () => {
    const { response } = invoke('DELETE');
    expect(response.statusCode).toBe(405);
    expect(response.getHeader('Allow')).toBe('GET, HEAD, POST');
  });
});
