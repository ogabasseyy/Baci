import { describe, expect, it, vi } from 'vitest';
import { extractGiglWebhookCiphertext } from './gigl-webhook-ciphertext';
import { GIG_DOC_SAMPLE_BODY } from './gigl-webhook-crypto.test-support';
import { GIGL_WEBHOOK_MAX_ENCRYPTED_CHARS } from './gigl-webhook-limits';

vi.mock('server-only', () => ({}));

describe('extractGiglWebhookCiphertext', () => {
  it('accepts the bare base64 body GIG documents', () => {
    expect(extractGiglWebhookCiphertext(`  ${GIG_DOC_SAMPLE_BODY}\n`)).toBe(
      GIG_DOC_SAMPLE_BODY
    );
  });

  it('accepts the same body sent as a JSON string', () => {
    expect(
      extractGiglWebhookCiphertext(JSON.stringify(GIG_DOC_SAMPLE_BODY))
    ).toBe(GIG_DOC_SAMPLE_BODY);
  });

  it.each([
    ['empty', ''],
    ['JSON object', '{"data":"abcd"}'],
    ['unterminated JSON string', '"abcd'],
    ['non-base64 characters', 'abc$'],
    ['unpadded length', 'abcde'],
    ['oversized', 'A'.repeat(GIGL_WEBHOOK_MAX_ENCRYPTED_CHARS + 4)],
  ])('rejects an %s body', (_label, body) => {
    expect(extractGiglWebhookCiphertext(body)).toBeNull();
  });
});
