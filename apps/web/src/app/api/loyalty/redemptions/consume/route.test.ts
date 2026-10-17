import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkCsrfProtection,
  makeRequest,
  POST,
  rpc,
  setAuthUser,
  setHasPermission,
  setRpcError,
  setRpcResult,
  setupConsumeMocks,
} from './route.test-support';

describe('POST /api/loyalty/redemptions/consume', () => {
  beforeEach(() => {
    setupConsumeMocks();
  });

  it('returns 401 before CSRF validation when unauthenticated', async () => {
    setAuthUser(null);

    const response = await POST(makeRequest({ code: 'RDM-ABC123' }));

    expect(response.status).toBe(401);
    expect(checkCsrfProtection).not.toHaveBeenCalled();
  });

  it('returns 403 when the user lacks edit permission', async () => {
    setHasPermission(false);

    const response = await POST(
      makeRequest({ code: 'RDM-ABC123', idempotency_key: 'attempt-1' })
    );

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 400 when the code is missing', async () => {
    const response = await POST(makeRequest({}));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain('code');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a consume without an idempotency key', async () => {
    // A keyless consume stamps NULL in the RPC, so its lost-response
    // retry could not be told apart from a re-presentation.
    const response = await POST(makeRequest({ code: 'RDM-ABC123' }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('consumes an unused manual redemption through the RPC', async () => {
    const response = await POST(
      makeRequest({ code: 'rdm-abc123', idempotency_key: 'attempt-1' })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      id: 'redemption-1',
      discount_code: 'RDM-ABC123',
      reward_type: 'free_product',
      reward_id: 'reward-1',
      reward_name: 'Free mug',
      reward_product_id: 'product-1',
      customer_id: 'customer-1',
      used_at: '2026-10-13T00:00:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('consume_loyalty_redemption', {
      p_merchant_id: 'merchant-1',
      p_code: 'rdm-abc123',
      p_idempotency_key: 'attempt-1',
    });
  });

  it('forwards the attempt key and returns 409 with the original receipt on reuse', async () => {
    setRpcResult({
      success: false,
      error: 'already_consumed',
      redemption_id: 'redemption-1',
      discount_code: 'RDM-ABC123',
      reward_type: 'free_product',
      reward_id: 'reward-1',
      reward_name: 'Free mug',
      reward_product_id: 'product-1',
      customer_id: 'customer-1',
      used_at: '2026-10-13T00:00:00.000Z',
    });

    const response = await POST(
      makeRequest({ code: 'RDM-ABC123', idempotency_key: 'attempt-9' })
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toBe('Redemption already consumed');
    expect(json.data.used_at).toBe('2026-10-13T00:00:00.000Z');
    expect(rpc).toHaveBeenCalledWith('consume_loyalty_redemption', {
      p_merchant_id: 'merchant-1',
      p_code: 'RDM-ABC123',
      p_idempotency_key: 'attempt-9',
    });
  });

  it('returns 404 when the RPC finds nothing (unknown or consumed)', async () => {
    setRpcResult({ success: false, error: 'redemption_not_found' });

    const response = await POST(
      makeRequest({ code: 'RDM-UNKNOWN', idempotency_key: 'attempt-1' })
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toContain('already consumed');
  });

  it('returns 403 when the RPC denies merchant access', async () => {
    setRpcResult({ success: false, error: 'forbidden' });

    const response = await POST(
      makeRequest({ code: 'RDM-ABC123', idempotency_key: 'attempt-1' })
    );

    expect(response.status).toBe(403);
  });

  it('returns 500 when the RPC fails', async () => {
    setRpcError({ message: 'db failure' });

    const response = await POST(
      makeRequest({ code: 'RDM-ABC123', idempotency_key: 'attempt-1' })
    );

    expect(response.status).toBe(500);
  });
});
