import { describe, expect, it } from 'vitest';
import { assessAgenticDvaCutoverSession } from './agentic-dva-cutover-evidence';
import { agenticDvaCutoverEvidenceTestSupport } from './agentic-dva-cutover-evidence-test-support';

const now = new Date('2026-07-20T12:00:00.000Z');
const { accountReadyRow, claimingRow } = agenticDvaCutoverEvidenceTestSupport;

describe('assessAgenticDvaCutoverSession', () => {
  it('requires manual review for a stale claim with no account evidence', () => {
    const result = assessAgenticDvaCutoverSession(claimingRow(), now);

    expect(result).toMatchObject({
      disposition: 'manual_review',
      reason: 'provider_outcome_unconfirmed',
      merchantId: 'merchant-1',
      sessionId: 'agentic_session_1',
      state: 'claiming_payment',
    });
    expect(result.evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks a fresh claim and a claim carrying account evidence', () => {
    expect(
      assessAgenticDvaCutoverSession(
        claimingRow({ updated_at: '2026-07-20T11:55:00.000Z' }),
        now
      )
    ).toMatchObject({
      disposition: 'manual_review',
      reason: 'claim_not_stale',
    });

    expect(
      assessAgenticDvaCutoverSession(
        claimingRow({ virtual_account_number: '1234567890' }),
        now
      )
    ).toMatchObject({
      disposition: 'manual_review',
      reason: 'claim_has_account_evidence',
    });
  });

  it('requires the stale claim to be an exact session-bound UUID reference', () => {
    expect(
      assessAgenticDvaCutoverSession(
        claimingRow({
          payment_reference:
            'agentic_claim_other_session_123e4567-e89b-12d3-a456-426614174000',
        }),
        now
      )
    ).toMatchObject({
      disposition: 'manual_review',
      reason: 'claim_reference_invalid',
    });
  });

  it('permits an account-ready session only with a complete immutable snapshot', () => {
    const result = assessAgenticDvaCutoverSession(accountReadyRow(), now);

    expect(result).toMatchObject({
      disposition: 'resume_stored_account',
      reason: null,
      state: 'payment_account_ready',
    });
    expect(result.resume?.unwrap()).toMatchObject({
      buyer: { email: 'buyer@example.com' },
      dvaAccount: { account_number: '1234567890' },
    });
    expect(JSON.stringify(result)).toContain('"resume":"[REDACTED]"');
    expect(JSON.stringify(result)).not.toContain('buyer@example.com');
    expect(JSON.stringify(result)).not.toContain('1234567890');

    expect(
      assessAgenticDvaCutoverSession(
        accountReadyRow({
          customer_email: null,
          customer_name: null,
          customer_phone: null,
        }),
        now
      )
    ).toMatchObject({
      disposition: 'resume_stored_account',
      reason: null,
    });
  });

  it('blocks account drift and pay-on-delivery finalization', () => {
    expect(
      assessAgenticDvaCutoverSession(
        accountReadyRow({ payment_reference: '9999999999' }),
        now
      )
    ).toMatchObject({
      disposition: 'manual_review',
      reason: 'stored_account_mismatch',
    });

    expect(
      assessAgenticDvaCutoverSession(
        accountReadyRow({
          metadata: {
            agentic: {
              payment_method: 'pay_on_delivery',
              payment_state: 'order_finalizing',
            },
          },
        }),
        now
      )
    ).toMatchObject({
      disposition: 'manual_review',
      reason: 'stored_account_missing',
    });
  });

  it('blocks invalid payment identity and divergent buyer snapshots', () => {
    const metadata = accountReadyRow().metadata as {
      agentic: Record<string, unknown>;
    };
    expect(
      assessAgenticDvaCutoverSession(
        accountReadyRow({
          metadata: {
            agentic: { ...metadata.agentic, buyer: null },
          },
        }),
        now
      )
    ).toMatchObject({
      disposition: 'manual_review',
      reason: 'buyer_or_payment_snapshot_missing',
    });

    const invalidIdentity = assessAgenticDvaCutoverSession(
      accountReadyRow({ payment_provider: 'other' }),
      now
    );
    expect(invalidIdentity).toMatchObject({
      actionPayload: null,
      disposition: 'manual_review',
      reason: 'payment_identity_invalid',
    });
    expect(JSON.stringify(invalidIdentity)).not.toContain('buyer@example.com');

    expect(
      assessAgenticDvaCutoverSession(
        accountReadyRow({ customer_email: 'different@example.com' }),
        now
      )
    ).toMatchObject({
      disposition: 'manual_review',
      reason: 'buyer_snapshot_mismatch',
    });
  });

  it('blocks a malformed finalization order marker', () => {
    const metadata = accountReadyRow().metadata as {
      agentic: Record<string, unknown>;
    };

    expect(
      assessAgenticDvaCutoverSession(
        accountReadyRow({
          metadata: {
            agentic: {
              ...metadata.agentic,
              finalization_order_id: 123,
            },
          },
        }),
        now
      )
    ).toMatchObject({
      disposition: 'manual_review',
      reason: 'finalization_order_id_invalid',
    });
  });

  it.each([
    [
      'identity_or_timestamp_missing',
      { session_id: null },
      'identity_or_timestamp_missing',
    ],
    [
      'updated_at_invalid',
      { updated_at: 'not-a-timestamp' },
      'updated_at_invalid',
    ],
    ['metadata_missing', { metadata: null }, 'metadata_missing'],
    [
      'state_not_transitional',
      { metadata: { agentic: { payment_state: null } } },
      'state_not_transitional',
    ],
    [
      'state_not_handled',
      { metadata: { agentic: { payment_state: 'paid' } } },
      'state_not_handled',
    ],
    [
      'session_status_not_mutable',
      { status: 'completed' },
      'session_status_not_mutable',
    ],
    [
      'session_already_has_order',
      { order_id: 'canceled-order-1' },
      'session_already_has_order',
    ],
  ])('fails closed for the %s guard', (_name, overrides, reason) => {
    const result = assessAgenticDvaCutoverSession(claimingRow(overrides), now);

    expect(result).toMatchObject({ disposition: 'manual_review', reason });
  });
});
