import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestIntakeClientFromExecutor } from './webhook-intake-client';

vi.mock('server-only', () => ({}));

function setup(result: unknown = []) {
  const execute = vi.fn(async () => result);
  return { execute, client: createPiggyvestIntakeClientFromExecutor(execute) };
}

describe('intake client: rpc', () => {
  it('maps the capture command', async () => {
    const { client, execute } = setup({ id: 'x' });
    const out = await client.rpc('capture_piggyvest_webhook_delivery', {
      p_command: { rawHex: 'aa' },
    });
    expect(execute).toHaveBeenCalledWith('capture_delivery', { rawHex: 'aa' });
    expect(out).toEqual({ data: { id: 'x' }, error: null });
  });

  it('maps inline capture completion and refuses anything else', async () => {
    const { client, execute } = setup(true);
    await client.rpc('resolve_piggyvest_webhook_capture', {
      p_id: 'c1',
      p_claim_token: null,
      p_state: 'processed',
      p_error: null,
    });
    expect(execute).toHaveBeenCalledWith('resolve_capture', {
      id: 'c1',
      state: 'processed',
    });
    execute.mockClear();
    for (const args of [
      { p_id: 'c1', p_claim_token: 't', p_state: 'processed', p_error: null },
      {
        p_id: 'c1',
        p_claim_token: null,
        p_state: 'needs_review',
        p_error: null,
      },
      { p_id: 'c1', p_claim_token: null, p_state: 'processed', p_error: 'x' },
    ]) {
      const out = await client.rpc('resolve_piggyvest_webhook_capture', args);
      expect(out.error?.code).toBe('PGRST_UNSUPPORTED');
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    [
      'claim_piggyvest_webhook_event',
      { p_event_id: 'e' },
      'claim_event',
      { event_id: 'e' },
    ],
    [
      'resolve_piggyvest_webhook_event',
      {
        p_event_id: 'e',
        p_claim_token: 't',
        p_status: 'processed',
        p_last_error: null,
      },
      'resolve_event',
      {
        event_id: 'e',
        claim_token: 't',
        status: 'processed',
        last_error: null,
      },
    ],
    [
      'apply_staging_wallet_restriction',
      { p_provider_wallet_id: 'w', p_restriction_status: 'ready' },
      'apply_staging_restriction',
      { wallet_id: 'w', status: 'ready' },
    ],
    [
      'resolve_staging_wallet_owner',
      { p_provider_customer_id: 'c', p_provider_wallet_id: 'w' },
      'resolve_staging_owner',
      { provider_customer_id: 'c', provider_wallet_id: 'w' },
    ],
    [
      'allocate_plan_transfer_contribution',
      {
        p_customer_id: 'c',
        p_merchant_id: 'm',
        p_amount_kobo: 5,
        p_provider_transaction_id: 't',
        p_idempotency_key: 'k',
        p_provider_wallet_id: 'w',
        p_provider_customer_id: 'pc',
      },
      'allocate_plan_transfer',
      {
        customer_id: 'c',
        merchant_id: 'm',
        amount_kobo: 5,
        provider_transaction_id: 't',
        idempotency_key: 'k',
        provider_wallet_id: 'w',
        provider_customer_id: 'pc',
      },
    ],
  ])('maps %s to %s', async (name, args, fn, payload) => {
    const { client, execute } = setup('ok');
    const out = await client.rpc(name, args);
    expect(execute).toHaveBeenCalledWith(fn, payload);
    expect(out).toEqual({ data: 'ok', error: null });
  });

  it('refuses an RPC that is not reviewed for the receiver', async () => {
    const { client, execute } = setup();
    const out = await client.rpc('admin_do_anything', {});
    expect(out.error?.code).toBe('PGRST_UNSUPPORTED');
    expect(execute).not.toHaveBeenCalled();
  });
});
