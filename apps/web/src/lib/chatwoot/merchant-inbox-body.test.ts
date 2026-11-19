import { describe, expect, it } from 'vitest';
import {
  MERCHANT_INBOX_BODY_MAX_BYTES,
  readMerchantInboxJsonBody,
} from './merchant-inbox-body';

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://x.test/', { method: 'POST', body, headers });

describe('readMerchantInboxJsonBody', () => {
  it('parses a valid JSON body', async () => {
    expect(await readMerchantInboxJsonBody(post('{"content":"hi"}'))).toEqual({
      ok: true,
      body: { content: 'hi' },
    });
  });

  it('fails on malformed JSON', async () => {
    expect(await readMerchantInboxJsonBody(post('{nope'))).toEqual({
      ok: false,
    });
  });

  it('fails on an empty body', async () => {
    expect(await readMerchantInboxJsonBody(post('   '))).toEqual({ ok: false });
  });

  it('rejects an oversized streamed body', async () => {
    const big = JSON.stringify({
      content: 'a'.repeat(MERCHANT_INBOX_BODY_MAX_BYTES),
    });
    expect(await readMerchantInboxJsonBody(post(big))).toEqual({ ok: false });
  });

  it('rejects when the declared length is over the cap', async () => {
    const result = await readMerchantInboxJsonBody(
      post('{}', {
        'content-length': String(MERCHANT_INBOX_BODY_MAX_BYTES + 1),
      })
    );
    expect(result).toEqual({ ok: false });
  });
});
