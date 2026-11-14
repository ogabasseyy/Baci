import { describe, expect, it } from 'vitest';
import { observeWebhook } from './observer';

const options = { path: '/events/test-secret', marker: 'private-marker' };
function request(body: string, headers: Record<string, string> = {}) {
  return new Request(`https://receiver.test${options.path}`, {
    method: 'POST',
    body,
    headers,
  });
}

describe('staging webhook observer', () => {
  it('records structure and known KYC states, never private values', async () => {
    const result = await observeWebhook(
      request(
        JSON.stringify({
          loan_request_reference: 'private-request',
          customer: { email: 'private@example.test', bvn: '12345678901' },
          payload: { selfie_status: 'DONE', status: 'PROCESSING' },
          token: 'private-token',
        }),
        {
          authorization: 'Bearer private-token',
          'x-oxygen-probe': options.marker,
        }
      ),
      options
    );
    expect(result.status).toBe(200);
    expect(result.observation?.markerMatched).toBe(true);
    expect(result.observation?.states).toEqual({
      'payload.selfie_status': 'DONE',
      'payload.status': 'PROCESSING',
    });
    expect(result.observation?.authentication).toBe('unverified');
    const serialized = JSON.stringify(result.observation);
    for (const value of [
      'private-request',
      'private@example.test',
      '12345678901',
      'private-token',
      options.marker,
    ]) {
      expect(serialized).not.toContain(value);
    }
    expect(result.observation?.headerNames).toContain('authorization');
  });
  it('does not record other routes or methods', async () => {
    expect(
      (await observeWebhook(new Request('https://receiver.test/'), options))
        .status
    ).toBe(404);
    expect(
      (
        await observeWebhook(
          new Request(`https://receiver.test${options.path}`),
          options
        )
      ).status
    ).toBe(405);
  });
  it('captures malformed delivery without persisting its contents', async () => {
    const result = await observeWebhook(
      request('private-malformed-body'),
      options
    );
    expect(result.status).toBe(200);
    expect(result.observation?.json).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-malformed-body');
  });
  it('rejects oversize bodies without an observation', async () => {
    const result = await observeWebhook(request('x'.repeat(262145)), options);
    expect(result).toEqual({ status: 413 });
  });
  it('does not trust a matching marker as verified provider authentication', async () => {
    const result = await observeWebhook(
      request('{"status":"unrecognized-private-value"}', {
        'x-oxygen-probe': options.marker,
      }),
      options
    );
    expect(result.observation?.states).toEqual({});
    expect(result.observation?.authentication).toBe('unverified');
  });
});
