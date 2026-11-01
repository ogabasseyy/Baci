import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  redeemImeiWalletAndBeginProviderSubmission,
  requestSickwCheck,
} from './imei-lookup-fulfillment';

const LOOKUP_ARGS = {
  apiKey: 'test-key',
  checksIncluded: ['device'],
  imei: '354442067957452',
  serviceId: '1',
  tierName: 'Full Check',
} as const;

describe('requestSickwCheck', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves a zero trust score from stacked provider penalties', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        status: 'success',
        result:
          'Model Name: iPhone 15\nBlacklist Status: Blacklisted\niCloud Lock: ON\nMDM Status: Active',
      })
    );
    const result = await requestSickwCheck(LOOKUP_ARGS);
    expect(result).toMatchObject({ ok: true, body: { data: { score: 0 } } });
  });

  it('returns normalized lookup data when the provider succeeds', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        result:
          'Model Name: iPhone 15 Pro\nModel Number: A3101\nBlacklist Status: Clean\niCloud Lock: Off\nSIM-Lock Status: Unlocked\nCarrier: Unlocked',
        status: 'success',
      })
    );

    const result = await requestSickwCheck(LOOKUP_ARGS);

    expect(result).toMatchObject({
      body: {
        data: {
          blacklistStatus: 'Clean',
          carrier: 'Unlocked',
          device: 'iPhone 15 Pro',
          icloudLock: 'Off',
          imei: LOOKUP_ARGS.imei,
          modelNumber: 'A3101',
          simLock: 'Unlocked',
        },
        success: true,
        tier: { checksIncluded: ['device'], name: 'Full Check' },
      },
      ok: true,
      sickwStatus: 'success',
      status: 200,
    });
  });

  it('forwards the extended Knox Guard / GSX / repair fields onto the result', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        result: [
          'Model Name: iPhone 15 Pro',
          'Knox Guard: Locked',
          'Part Number: MTP03LL/A',
          'Repair Eligibility: Eligible',
          'Coverage: AppleCare+ Active',
          'Repair History: 1 repair',
          'Replacement Status: Replaced by Apple',
          'eSIM Compatibility: Supported',
          'Finance Status: Clean',
          'Knox Enrollment: Not Enrolled',
          'Sold By: Apple Store',
          'WiFi MAC: AA:BB:CC:DD:EE:FF',
          'Device Photo: https://example.com/device.jpg',
        ].join('\n'),
        status: 'success',
      })
    );

    const result = await requestSickwCheck(LOOKUP_ARGS);

    expect(result).toMatchObject({
      body: {
        data: {
          knoxGuardStatus: 'Locked',
          partNumber: 'MTP03LL/A',
          repairEligibility: 'Eligible',
          gsxCoverage: 'AppleCare+ Active',
          repairHistory: '1 repair',
          replacementHistory: 'Replaced by Apple',
          esimCompatibility: 'Supported',
          financeStatus: 'Clean',
          knoxEnrollment: 'Not Enrolled',
          soldBy: 'Apple Store',
          wifiMac: 'AA:BB:CC:DD:EE:FF',
          devicePhoto: 'https://example.com/device.jpg',
        },
        success: true,
      },
      ok: true,
      status: 200,
    });
  });

  it('maps provider not-found messages to a refunded 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ message: 'IMEI not found', status: 'error' })
    );

    const result = await requestSickwCheck(LOOKUP_ARGS);

    expect(result).toMatchObject({
      body: { code: 'SICKW_NOT_FOUND', success: false },
      ok: false,
      refundReason: 'not_found',
      sickwStatus: 'not_found',
      status: 404,
    });
  });

  it.each([
    'Invalid API key',
    'Invalid service id',
  ])('maps provider configuration errors to a refunded 502: %s', async (message) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ message, status: 'error' })
    );

    const result = await requestSickwCheck(LOOKUP_ARGS);

    expect(result).toMatchObject({
      body: { code: 'SICKW_UNAVAILABLE', success: false },
      ok: false,
      refundReason: 'error',
      sickwStatus: 'provider_error',
      status: 502,
    });
  });

  it('refunds a rejected unsupported-serial response instead of charging for it', async () => {
    // Shape of the live Sickw payload that was billed as a "success" in prod:
    // a modern 10-character Apple serial rejected by the serial-info service.
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        imei: 'F0ABCD1234',
        result: 'Rejected: 10 Characters Serial Not supported!',
        status: 'rejected',
      })
    );

    const result = await requestSickwCheck(LOOKUP_ARGS);

    expect(result).toMatchObject({
      body: { code: 'SICKW_NOT_FOUND', success: false },
      ok: false,
      refundReason: 'not_found',
      sickwStatus: 'not_found',
      status: 404,
    });
  });

  it('maps a generic rejected status to a refunded 502', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ result: 'Rejected: try again later', status: 'rejected' })
    );

    const result = await requestSickwCheck(LOOKUP_ARGS);

    expect(result).toMatchObject({
      body: { code: 'SICKW_UNAVAILABLE', success: false },
      ok: false,
      refundReason: 'error',
      sickwStatus: 'provider_error',
      status: 502,
    });
  });

  it('treats a "Rejected:" result string as an error even without a status field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ result: 'Rejected: 10 Characters Serial Not supported!' })
    );

    const result = await requestSickwCheck(LOOKUP_ARGS);

    expect(result).toMatchObject({
      ok: false,
      refundReason: 'not_found',
      status: 404,
    });
  });
});

describe('redeemImeiWalletAndBeginProviderSubmission', () => {
  it('uses the atomic Petrock debit-and-classify RPC', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [{ success: true }], error: null });

    await redeemImeiWalletAndBeginProviderSubmission({
      amount: 1500,
      costUsd: 0.019,
      customerId: 'customer-1',
      deviceCategory: 'smartphone',
      feedbackTokenHash: 'token-hash',
      identifierCiphertext: 'ciphertext',
      lookupId: 'lookup-1',
      merchantId: 'merchant-1',
      providerAttemptStartedAt: '2026-07-10T12:00:00.000Z',
      referenceId: 'reference-1',
      supabaseAdmin: { rpc } as never,
    });

    expect(rpc).toHaveBeenCalledWith(
      'redeem_imei_wallet_and_begin_provider_submission',
      expect.objectContaining({
        p_cost_usd: 0.019,
        p_feedback_token_hash: 'token-hash',
        p_identifier_ciphertext: 'ciphertext',
        p_lookup_id: 'lookup-1',
        p_provider: 'petrock',
        p_reference_id: 'reference-1',
      })
    );
  });
});
