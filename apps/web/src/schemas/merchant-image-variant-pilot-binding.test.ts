import { describe, expect, it } from 'vitest';
import {
  parsePilotInventoryBinding,
  pilotInventoryBindingSchema,
} from './merchant-image-variant-pilot-binding';

const validBinding = {
  assetId: 'logo-1',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  originalUrl: 'https://cdn.example.com/media/logo.png',
  role: 'logo' as const,
  slotId: 'header-logo',
  sourceSha256: 'a'.repeat(64),
};

describe('pilotInventoryBindingSchema and parsePilotInventoryBinding', () => {
  it('accepts valid bindings and rejects path traversal or invalid URLs', () => {
    expect(pilotInventoryBindingSchema.safeParse(validBinding).success).toBe(
      true
    );
    expect(parsePilotInventoryBinding(validBinding)).toEqual({
      binding: validBinding,
      ok: true,
    });

    expect(
      parsePilotInventoryBinding({ ...validBinding, assetId: '../escape' }).ok
    ).toBe(false);
    expect(
      parsePilotInventoryBinding({
        ...validBinding,
        originalUrl: 'ftp://cdn.example.com/logo.png',
      }).ok
    ).toBe(false);
  });
});
