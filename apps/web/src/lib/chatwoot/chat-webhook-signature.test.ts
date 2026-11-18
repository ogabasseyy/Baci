import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { verifyChatWebhookSignature } from './chat-webhook-signature';

const SECRET = 'synthetic-webhook-signing-secret-0001';
const NOW = 1_794_730_000;
const BODY = '{"event":"message_created","id":128}';

function sign(body = BODY, timestamp = NOW, secret = SECRET) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

function verify(
  overrides: Partial<Parameters<typeof verifyChatWebhookSignature>[0]> = {}
) {
  return verifyChatWebhookSignature({
    rawBody: BODY,
    signatureHeader: sign(),
    timestampHeader: String(NOW),
    secret: SECRET,
    nowSeconds: NOW,
    ...overrides,
  });
}

describe('verifyChatWebhookSignature', () => {
  it('accepts the provider signature over "<timestamp>.<raw body>"', () => {
    expect(verify()).toBe(true);
  });

  it('accepts a timestamp at the edge of the tolerance', () => {
    expect(verify({ nowSeconds: NOW + 300 })).toBe(true);
    expect(verify({ nowSeconds: NOW - 300 })).toBe(true);
  });

  it.each([
    ['a replay after the tolerance', { nowSeconds: NOW + 301 }],
    ['a timestamp from the future', { nowSeconds: NOW - 301 }],
    ['a changed body', { rawBody: `${BODY} ` }],
    [
      'a signature from another secret',
      {
        signatureHeader: sign(BODY, NOW, 'another-secret-another-secret-0002'),
      },
    ],
    [
      'a signature for another timestamp',
      { signatureHeader: sign(BODY, NOW - 10) },
    ],
    ['a missing signature', { signatureHeader: null }],
    ['a missing timestamp', { timestampHeader: null }],
    [
      'an unprefixed signature',
      { signatureHeader: sign().slice('sha256='.length) },
    ],
    ['a non-numeric timestamp', { timestampHeader: 'yesterday' }],
    ['an empty secret', { secret: '' }],
  ])('rejects %s', (_label, overrides) => {
    expect(verify(overrides)).toBe(false);
  });
});
