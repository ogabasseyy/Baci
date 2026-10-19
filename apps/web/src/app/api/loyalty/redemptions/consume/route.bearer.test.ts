import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkCsrfProtection,
  MOBILE_AUTH_TOKEN,
  makeRequest,
  POST,
  rpc,
  setCsrfValid,
  setupConsumeMocks,
} from './route.test-support';

describe('POST /api/loyalty/redemptions/consume (Bearer [REDACTED])', () => {
  beforeEach(() => {
    setupConsumeMocks();
  });

  it('consumes for a Bearer-authenticated mobile caller without CSRF', async () => {
    setCsrfValid(false);

    const response = await POST(
      makeRequest(
        { code: 'RDM-ABC123', idempotency_key: 'attempt-mobile' },
        { authorization: `Bearer ${MOBILE_AUTH_TOKEN}` }
      )
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(checkCsrfProtection).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('consume_loyalty_redemption', {
      p_merchant_id: 'merchant-1',
      p_code: 'RDM-ABC123',
      p_idempotency_key: 'attempt-mobile',
    });
  });

  it('still enforces CSRF for a cookie session carrying a bare Bearer [REDACTED]', async () => {
    // A bare `Authorization: Bearer` header extracts no token, so the
    // request authenticates by cookie and must not skip CSRF.
    setCsrfValid(false);

    const response = await POST(
      makeRequest(
        { code: 'RDM-ABC123', idempotency_key: 'attempt-mobile' },
        { authorization: 'Bearer' }
      )
    );

    expect(response.status).toBe(403);
    expect(checkCsrfProtection).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('consumes for a cookie session with a bare Bearer [REDACTED] when CSRF passes', async () => {
    const response = await POST(
      makeRequest(
        { code: 'RDM-ABC123', idempotency_key: 'attempt-cookie' },
        { authorization: 'Bearer' }
      )
    );

    expect(response.status).toBe(200);
    expect(checkCsrfProtection).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('consume_loyalty_redemption', {
      p_merchant_id: 'merchant-1',
      p_code: 'RDM-ABC123',
      p_idempotency_key: 'attempt-cookie',
    });
  });

  it('rejects an invalid Bearer [REDACTED] before CSRF and the RPC', async () => {
    const response = await POST(
      makeRequest(
        { code: 'RDM-ABC123', idempotency_key: 'attempt-mobile' },
        { authorization: `Bearer ${['wrong', 'token'].join('-')}` }
      )
    );

    expect(response.status).toBe(401);
    expect(checkCsrfProtection).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
