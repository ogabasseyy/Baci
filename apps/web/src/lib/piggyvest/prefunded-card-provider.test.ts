import { describe, expect, it, vi } from 'vitest';
import { createPrefundedCardProvider } from './prefunded-card-provider';

import { prefundedCardProviderTestFixture } from './prefunded-card-provider.test-fixture';

vi.mock('server-only', () => ({}));

const { claim, providerSettings, savedMethod, jsonResponse } =
  prefundedCardProviderTestFixture;

describe('prefunded card provider', () => {
  it('sends integer kobo as a string with the pinned NGN charge currency', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        data: { reference: claim.collectionReference, status: 'pending' },
      })
    );
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation,
      resolveSavedMethod: vi.fn().mockResolvedValue(savedMethod),
    });

    await expect(provider.submitCollection(claim)).resolves.toEqual({
      outcome: 'submitted_for_verification',
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/charge_authorization',
      expect.objectContaining({ method: 'POST', redirect: 'error' })
    );
    expect(JSON.parse(fetchImplementation.mock.calls[0][1].body)).toEqual({
      amount: '5000',
      authorization_code: 'AUTH_test_authorization',
      currency: 'NGN',
      email: 'customer@example.test',
      reference: 'collection-1',
    });
  });

  it('rejects a mismatched treasury business before sending a transfer', async () => {
    const fetchImplementation = vi.fn();
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation,
      resolveSavedMethod: vi.fn(),
    });

    await expect(
      provider.submitTransfer({ ...claim, businessId: 'wrong_business' })
    ).resolves.toEqual({ outcome: 'reconciliation_required' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects a mismatched business before charging the saved card', async () => {
    const fetchImplementation = vi.fn();
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation,
      resolveSavedMethod: vi.fn(),
    });

    await expect(
      provider.submitCollection({ ...claim, businessId: 'wrong_business' })
    ).resolves.toEqual({ outcome: 'reconciliation_required' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    'collection_reference',
    'collection:reference',
    'collection/reference',
  ])('does not send a Paystack charge with an invalid provider reference: %s', async (collectionReference) => {
    const fetchImplementation = vi.fn();
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation,
      resolveSavedMethod: vi.fn(),
    });

    const submission = provider.submitCollection({
      ...claim,
      collectionReference,
    });
    if (collectionReference.includes('/')) {
      await expect(submission).rejects.toThrow();
    } else {
      await expect(submission).resolves.toEqual({
        outcome: 'reconciliation_required',
      });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    ['integrationId', '10000000-0000-4000-8000-000000000010'],
    ['merchantId', '10000000-0000-4000-8000-000000000011'],
    ['treasuryBindingId', '10000000-0000-4000-8000-000000000012'],
    ['sourceWalletId', 'other_source_wallet'],
  ])('rejects a mismatched %s before charging', async (key, value) => {
    const fetchImplementation = vi.fn();
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation,
      resolveSavedMethod: vi.fn(),
    });

    await expect(
      provider.submitCollection({ ...claim, [key]: value })
    ).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects an inactive saved authorization before charging', async () => {
    const fetchImplementation = vi.fn();
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation,
      resolveSavedMethod: vi.fn().mockResolvedValue({
        ...savedMethod,
        active: false,
        reusable: true,
        domain: 'test',
      }),
    });

    await expect(provider.submitCollection(claim)).rejects.toThrow();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('sends a PiggyVest wallet transfer to the staging-only endpoint', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { status: true, message: 'Peer to Peer Wallet transfer processing' },
          202
        )
      );
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation,
      resolveSavedMethod: vi.fn(),
    });

    await expect(provider.submitTransfer(claim)).resolves.toEqual({
      outcome: 'submitted_for_verification',
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://staging.piggyvest.business/api/v1/transfer/wallet',
      expect.objectContaining({ method: 'POST', redirect: 'error' })
    );
    expect(JSON.parse(fetchImplementation.mock.calls[0][1].body)).toEqual({
      amount: 5000,
      source: 'wallet_source',
      destination: 'wallet_destination',
      currency: 'NGN',
      reference: 'transfer-1',
    });
  });
});
