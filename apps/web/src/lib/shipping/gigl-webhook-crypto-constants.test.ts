import { describe, expect, it } from 'vitest';
import {
  GIGL_WEBHOOK_BLOCK_BYTES,
  GIGL_WEBHOOK_HEADER_BYTES,
  GIGL_WEBHOOK_IV_BYTES,
  GIGL_WEBHOOK_KEY_BYTES,
  GIGL_WEBHOOK_PBKDF2_ITERATIONS,
  GIGL_WEBHOOK_SALT_BYTES,
} from './gigl-webhook-crypto-constants';

describe('GIG webhook crypto constants', () => {
  it("matches GIG's documented AES-256-CBC/PBKDF2 scheme", () => {
    expect(GIGL_WEBHOOK_SALT_BYTES).toBe(16);
    expect(GIGL_WEBHOOK_IV_BYTES).toBe(16);
    expect(GIGL_WEBHOOK_BLOCK_BYTES).toBe(16);
    expect(GIGL_WEBHOOK_KEY_BYTES).toBe(32);
    expect(GIGL_WEBHOOK_PBKDF2_ITERATIONS).toBe(10_000);
  });

  it('frames the header as salt followed by iv', () => {
    expect(GIGL_WEBHOOK_HEADER_BYTES).toBe(32);
  });
});
