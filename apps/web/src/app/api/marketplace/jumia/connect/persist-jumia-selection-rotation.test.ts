import { describe, expect, it, vi } from 'vitest';
import { preserveJumiaSelfAuthorizationDiscoveryAfterRotation } from '@/lib/jumia/self-authorization-discovery-store';
import { persistJumiaSelectionRotation } from './persist-jumia-selection-rotation';

vi.mock('@/lib/jumia/self-authorization-discovery-store', () => ({
  preserveJumiaSelfAuthorizationDiscoveryAfterRotation: vi.fn(),
}));

describe('persistJumiaSelectionRotation', () => {
  it('records the rotation version and preserves a fallback discovery handle', async () => {
    vi.mocked(
      preserveJumiaSelfAuthorizationDiscoveryAfterRotation
    ).mockResolvedValue('fallback-discovery');
    const expectedRotationVersionRef: { current?: number } = {};
    const recoveryDiscoveryIdRef: { current?: string } = {};

    await persistJumiaSelectionRotation({
      supabase: {} as never,
      discoveryId: 'discovery-1',
      merchantId: 'merchant-1',
      clientKeyHash: 'a'.repeat(64),
      claimToken: 'claim-1',
      credentialCiphertext: 'ciphertext',
      expectedRotationVersion: 4,
      expectedRotationVersionRef,
      recoveryDiscoveryIdRef,
    });

    expect(expectedRotationVersionRef.current).toBe(4);
    expect(recoveryDiscoveryIdRef.current).toBe('fallback-discovery');
    expect(
      preserveJumiaSelfAuthorizationDiscoveryAfterRotation
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        discoveryId: 'discovery-1',
        credentialCiphertext: 'ciphertext',
      })
    );
  });

  it('does not replace the recovery handle when the claimed record is updated', async () => {
    vi.mocked(
      preserveJumiaSelfAuthorizationDiscoveryAfterRotation
    ).mockResolvedValue(null);
    const recoveryDiscoveryIdRef = { current: 'existing-fallback' };

    await persistJumiaSelectionRotation({
      supabase: {} as never,
      discoveryId: 'discovery-1',
      merchantId: 'merchant-1',
      clientKeyHash: 'a'.repeat(64),
      claimToken: 'claim-1',
      credentialCiphertext: 'ciphertext',
      expectedRotationVersion: 4,
      expectedRotationVersionRef: {},
      recoveryDiscoveryIdRef,
    });

    expect(recoveryDiscoveryIdRef.current).toBe('existing-fallback');
  });
});
