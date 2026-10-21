import { describe, expect, it, vi } from 'vitest';
import { respondToClaimError } from './vtu-claim-rejection';

describe('respondToClaimError', () => {
  it('maps a same-key changed-payload race to 409', async () => {
    const response = respondToClaimError(
      { message: 'claim_fingerprint_mismatch: key mapped' },
      'txn-1'
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: expect.stringMatching(/different request payload/),
    });
  });

  it('maps a scope mismatch to 400', async () => {
    const response = respondToClaimError(
      { message: 'claim_scope_mismatch: tenant' },
      'txn-2'
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.stringMatching(/does not belong to this customer/),
    });
  });

  it('maps anything else to 500 without leaking the raw error', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const response = respondToClaimError(
        { message: 'secret-db-detail: connection reset' },
        'txn-3'
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({
        error: 'Failed to claim VTU purchase intent.',
      });
      expect(JSON.stringify(body)).not.toContain('secret-db-detail');
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to claim/),
        { error: 'secret-db-detail: connection reset', transactionId: 'txn-3' }
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
