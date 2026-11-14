import { describe, expect, it, vi } from 'vitest';

// A partial @/env mock without getExpoAccessToken, as many route tests use.
vi.mock('@/env', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

describe('bugfix: expo-push read the Expo token at import time', () => {
  it('imports without touching getExpoAccessToken until a push is sent', async () => {
    await expect(import('./expo-push')).resolves.toHaveProperty(
      'notifyMerchant'
    );
    await expect(import('./expo-client')).resolves.toHaveProperty(
      'getExpoClient'
    );
  });
});
