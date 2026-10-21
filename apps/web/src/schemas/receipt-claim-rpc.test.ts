import { describe, expect, it } from 'vitest';
import {
  createReceiptClaimResultSchema,
  receiptClaimCampaignStatsSchema,
  receiptClaimRecordSchema,
  redeemReceiptClaimResultSchema,
} from '@/schemas/receipt-claim-rpc';

describe('receipt claim RPC schemas', () => {
  it('accepts preview claim records returned by the preview RPC', () => {
    expect(
      receiptClaimRecordSchema.safeParse({
        claimed_at: null,
        claimed_by_user_id: null,
        customer_email: 'ada@example.com',
        customer_id: 'customer-1',
        customer_name: 'Ada',
        expires_at: '2099-01-01T00:00:00.000Z',
        id: 'claim-1',
        merchant_id: 'merchant-1',
        merchant: { business_name: 'Ogabassey', slug: 'ogabassey' },
        orders: [
          {
            id: 'order-1',
            order_items: [{ name: 'iPhone 16 Pro Max', quantity: 1 }],
            order_number: '06485',
          },
        ],
      }).success
    ).toBe(true);
  });

  it('accepts trimmed preview records without the retired identity fields', () => {
    // The anon preview payload no longer carries top-level customer_id,
    // merchant_id, or claimed_by_user_id; the loader must parse the
    // trimmed shape (and the legacy full shape above keeps parsing for
    // mixed-version rollout pairs).
    expect(
      receiptClaimRecordSchema.safeParse({
        claimed_at: null,
        customer_email: 'ada@example.com',
        customer_name: 'Ada',
        expires_at: '2099-01-01T00:00:00.000Z',
        id: 'claim-1',
        merchant: { business_name: 'Ogabassey', slug: 'ogabassey' },
        orders: [],
      }).success
    ).toBe(true);
  });

  it('rejects malformed preview claim records', () => {
    expect(
      receiptClaimRecordSchema.safeParse({
        claimed_at: null,
        customer_email: 'ada@example.com',
        customer_id: 'customer-1',
      }).success
    ).toBe(false);
  });

  it('accepts known redemption statuses and rejects unknown statuses', () => {
    expect(
      redeemReceiptClaimResultSchema.safeParse({
        redirectPath: '/receipts',
        status: 'ok',
      }).success
    ).toBe(true);
    expect(
      redeemReceiptClaimResultSchema.safeParse({
        status: 'needs_manual_review',
      }).success
    ).toBe(false);
    expect(
      redeemReceiptClaimResultSchema.safeParse({
        redirectPath: 'https://evil.example/receipts',
        status: 'ok',
      }).success
    ).toBe(false);
    expect(
      redeemReceiptClaimResultSchema.safeParse({
        redirectPath: '//evil.example/receipts',
        status: 'ok',
      }).success
    ).toBe(false);
    expect(
      redeemReceiptClaimResultSchema.safeParse({
        redirectPath: '/%2f%2fevil.example/receipts',
        status: 'ok',
      }).success
    ).toBe(false);
    expect(
      redeemReceiptClaimResultSchema.safeParse({
        redirectPath: '/receipts/..',
        status: 'ok',
      }).success
    ).toBe(false);
    expect(redeemReceiptClaimResultSchema.safeParse({}).success).toBe(false);
  });

  it('rejects external and protocol-relative redirect paths', () => {
    expect(
      redeemReceiptClaimResultSchema.safeParse({
        redirectPath: 'https://evil.test',
        status: 'ok',
      }).success
    ).toBe(false);
    expect(
      redeemReceiptClaimResultSchema.safeParse({
        redirectPath: '//evil.test',
        status: 'ok',
      }).success
    ).toBe(false);
  });

  it('accepts known create-claim statuses and rejects unknown statuses', () => {
    expect(
      createReceiptClaimResultSchema.safeParse({
        claim_id: 'claim-1',
        status: 'created',
      }).success
    ).toBe(true);
    expect(
      createReceiptClaimResultSchema.safeParse({
        status: 'skipped',
      }).success
    ).toBe(true);
    expect(
      createReceiptClaimResultSchema.safeParse({
        status: 'queued',
      }).success
    ).toBe(false);
  });

  it('accepts receipt claim campaign stats returned for migration dashboards', () => {
    const parsed = receiptClaimCampaignStatsSchema.safeParse({
      appDownloadClickCount: 3,
      appDownloadClickedCount: 1,
      claimedAppCount: 1,
      claimedCount: 1,
      claimedUnknownCount: 0,
      claimedWebCount: 0,
      clickedAppCount: 0,
      clickedCount: 2,
      clickedUnknownCount: 0,
      clickedWebCount: 2,
      lastActivityAt: '2026-06-27T10:05:00+00:00',
      loginStartedAppCount: 0,
      loginStartedCount: 1,
      loginStartedUnknownCount: 0,
      loginStartedWebCount: 1,
      recipients: [
        {
          appDownloadClickCount: 3,
          claimedAt: '2026-06-27T10:05:00+00:00',
          claimedSource: 'app',
          clickCount: 3,
          customerEmail: 'ada@example.com',
          customerName: 'Ada Lovelace',
          firstAppDownloadClickedAt: '2026-06-27T10:03:00+00:00',
          firstAppDownloadSource: 'app_store',
          firstClickedAt: '2026-06-27T10:00:00+00:00',
          firstClickSource: 'web',
          firstLoginStartedAt: '2026-06-27T10:01:00+00:00',
          firstLoginStartedSource: 'web',
          id: 'claim-1',
          lastAppDownloadClickedAt: '2026-06-27T10:04:00+00:00',
          lastAppDownloadSource: 'play_store',
          lastClickedAt: '2026-06-27T10:02:00+00:00',
          lastClickSource: 'web',
          lastLoginStartedAt: '2026-06-27T10:01:00+00:00',
          lastLoginStartedSource: 'web',
          loginStartedCount: 1,
          notificationSentAt: '2026-06-27T09:59:00+00:00',
        },
      ],
      sentCount: 3,
      totalRecipients: 3,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error('expected campaign stats to parse');
    }
    expect(parsed.data).toMatchObject({
      appDownloadClickCount: 3,
      appDownloadClickedCount: 1,
      claimedAppCount: 1,
      claimedUnknownCount: 0,
      claimedWebCount: 0,
      clickedUnknownCount: 0,
      clickedWebCount: 2,
      loginStartedUnknownCount: 0,
      loginStartedWebCount: 1,
      recipients: [
        expect.objectContaining({
          appDownloadClickCount: 3,
          claimedSource: 'app',
          firstAppDownloadSource: 'app_store',
          firstClickSource: 'web',
          firstLoginStartedSource: 'web',
          lastAppDownloadSource: 'play_store',
        }),
      ],
    });
  });

  it('accepts legacy campaign stats while the database migration is rolling out', () => {
    const parsed = receiptClaimCampaignStatsSchema.safeParse({
      claimedCount: 1,
      clickedCount: 2,
      lastActivityAt: '2026-06-27T10:05:00+00:00',
      loginStartedCount: 1,
      recipients: [
        {
          claimedAt: '2026-06-27T10:05:00+00:00',
          clickCount: 3,
          customerEmail: 'ada@example.com',
          customerName: 'Ada Lovelace',
          firstClickedAt: '2026-06-27T10:00:00+00:00',
          firstLoginStartedAt: '2026-06-27T10:01:00+00:00',
          id: 'claim-1',
          lastClickedAt: '2026-06-27T10:02:00+00:00',
          lastLoginStartedAt: '2026-06-27T10:01:00+00:00',
          loginStartedCount: 1,
          notificationSentAt: '2026-06-27T09:59:00+00:00',
        },
      ],
      sentCount: 3,
      totalRecipients: 3,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error('expected legacy campaign stats to parse');
    }
    expect(parsed.data).toMatchObject({
      appDownloadClickCount: 0,
      appDownloadClickedCount: 0,
      claimedAppCount: 0,
      claimedUnknownCount: 0,
      claimedWebCount: 1,
      clickedAppCount: 0,
      clickedUnknownCount: 0,
      clickedWebCount: 2,
      loginStartedAppCount: 0,
      loginStartedUnknownCount: 0,
      loginStartedWebCount: 1,
      recipients: [
        expect.objectContaining({
          appDownloadClickCount: 0,
          claimedSource: 'web',
          firstClickSource: 'web',
          firstLoginStartedSource: 'web',
          lastAppDownloadSource: null,
        }),
      ],
    });
  });

  it('derives rollout web counters from totals after app and unknown counts', () => {
    const parsed = receiptClaimCampaignStatsSchema.safeParse({
      claimedAppCount: 1,
      claimedCount: 4,
      claimedUnknownCount: 1,
      clickedAppCount: 2,
      clickedCount: 5,
      clickedUnknownCount: 1,
      lastActivityAt: null,
      loginStartedAppCount: 1,
      loginStartedCount: 3,
      loginStartedUnknownCount: 1,
      recipients: [],
      sentCount: 5,
      totalRecipients: 5,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error('expected rollout campaign stats to parse');
    }
    expect(parsed.data).toMatchObject({
      claimedWebCount: 2,
      clickedWebCount: 2,
      loginStartedWebCount: 1,
    });
  });

  it('defaults legacy app-download sources to unknown when timestamps exist without sources', () => {
    const parsed = receiptClaimCampaignStatsSchema.safeParse({
      claimedCount: 0,
      clickedCount: 0,
      lastActivityAt: '2026-06-27T10:05:00+00:00',
      loginStartedCount: 0,
      recipients: [
        {
          claimedAt: null,
          clickCount: 0,
          customerEmail: 'ada@example.com',
          customerName: 'Ada Lovelace',
          firstAppDownloadClickedAt: '2026-06-27T10:03:00+00:00',
          firstClickedAt: null,
          firstLoginStartedAt: null,
          id: 'claim-1',
          lastAppDownloadClickedAt: '2026-06-27T10:04:00+00:00',
          lastClickedAt: null,
          lastLoginStartedAt: null,
          loginStartedCount: 0,
          notificationSentAt: null,
        },
      ],
      sentCount: 1,
      totalRecipients: 1,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error('expected legacy app-download sources to parse');
    }

    expect(parsed.data.recipients[0]).toMatchObject({
      firstAppDownloadSource: 'unknown',
      lastAppDownloadSource: 'unknown',
    });
  });

  it('rejects campaign recipients with timestamp and source mismatches', () => {
    const recipient = {
      appDownloadClickCount: 1,
      claimedAt: null,
      claimedSource: null,
      clickCount: 1,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      firstAppDownloadClickedAt: '2026-06-27T10:03:00+00:00',
      firstAppDownloadSource: 'app_store' as const,
      firstClickedAt: '2026-06-27T10:00:00+00:00',
      firstClickSource: 'web' as const,
      firstLoginStartedAt: null,
      firstLoginStartedSource: null,
      id: 'claim-1',
      lastAppDownloadClickedAt: '2026-06-27T10:04:00+00:00',
      lastAppDownloadSource: 'play_store' as const,
      lastClickedAt: null,
      lastClickSource: null,
      lastLoginStartedAt: null,
      lastLoginStartedSource: null,
      loginStartedCount: 0,
      notificationSentAt: '2026-06-27T09:59:00+00:00',
    };
    const stats = {
      appDownloadClickCount: 1,
      appDownloadClickedCount: 1,
      claimedAppCount: 0,
      claimedCount: 0,
      claimedWebCount: 0,
      clickedAppCount: 0,
      clickedCount: 1,
      clickedWebCount: 1,
      lastActivityAt: '2026-06-27T10:05:00+00:00',
      loginStartedAppCount: 0,
      loginStartedCount: 0,
      loginStartedWebCount: 0,
      recipients: [recipient],
      sentCount: 1,
      totalRecipients: 1,
    };

    expect(
      receiptClaimCampaignStatsSchema.safeParse({
        ...stats,
        recipients: [{ ...recipient, firstClickSource: null }],
      }).success
    ).toBe(false);
    expect(
      receiptClaimCampaignStatsSchema.safeParse({
        ...stats,
        recipients: [
          {
            ...recipient,
            firstAppDownloadClickedAt: null,
          },
        ],
      }).success
    ).toBe(false);
  });

  it('rejects campaign stats with negative counters', () => {
    expect(
      receiptClaimCampaignStatsSchema.safeParse({
        claimedCount: 0,
        clickedCount: 0,
        lastActivityAt: null,
        loginStartedCount: 0,
        recipients: [],
        sentCount: -1,
        totalRecipients: 0,
      }).success
    ).toBe(false);
  });

  it('rejects campaign stats with malformed timestamp fields', () => {
    expect(
      receiptClaimCampaignStatsSchema.safeParse({
        claimedCount: 0,
        clickedCount: 0,
        lastActivityAt: 'not-a-date',
        loginStartedCount: 0,
        recipients: [],
        sentCount: 0,
        totalRecipients: 0,
      }).success
    ).toBe(false);

    expect(
      receiptClaimCampaignStatsSchema.safeParse({
        claimedCount: 0,
        clickedCount: 0,
        lastActivityAt: null,
        loginStartedCount: 0,
        recipients: [
          {
            claimedAt: null,
            clickCount: 0,
            customerEmail: 'ada@example.com',
            customerName: null,
            firstClickedAt: 'not-a-date',
            firstLoginStartedAt: null,
            id: 'claim-1',
            lastClickedAt: null,
            lastLoginStartedAt: null,
            loginStartedCount: 0,
            notificationSentAt: null,
          },
        ],
        sentCount: 0,
        totalRecipients: 1,
      }).success
    ).toBe(false);
  });
});
