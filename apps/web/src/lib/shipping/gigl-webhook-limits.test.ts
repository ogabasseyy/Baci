import { describe, expect, it } from 'vitest';
import {
  GIGL_WEBHOOK_MAX_BODY_BYTES,
  GIGL_WEBHOOK_MAX_ENCRYPTED_CHARS,
  GIGL_WEBHOOK_READ_TIMEOUT_MS,
} from './gigl-webhook-limits';

describe('GIG webhook request limits', () => {
  it('caps the body at 16 KiB and the read at five seconds', () => {
    expect(GIGL_WEBHOOK_MAX_BODY_BYTES).toBe(16_384);
    expect(GIGL_WEBHOOK_READ_TIMEOUT_MS).toBe(5_000);
  });

  it('never accepts more ciphertext than the body cap can carry', () => {
    expect(GIGL_WEBHOOK_MAX_ENCRYPTED_CHARS).toBeLessThanOrEqual(
      GIGL_WEBHOOK_MAX_BODY_BYTES
    );
  });
});
