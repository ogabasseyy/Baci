import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestIntakeClientFromExecutor } from './webhook-intake-client';
import { PiggyvestIntakeDbError } from './webhook-intake-executor';

vi.mock('server-only', () => ({}));

function setup(result: unknown = []) {
  const execute = vi.fn(async () => result);
  return { execute, client: createPiggyvestIntakeClientFromExecutor(execute) };
}

describe('intake client: table operations', () => {
  it('maps an inbox upsert to inbox_insert and projects the selected key', async () => {
    const { client, execute } = setup([{ event_id: 'e1' }]);
    const out = await client
      .from('piggyvest_webhook_inbox')
      .upsert(
        { event_id: 'e1', status: 'pending', event_details: null },
        { onConflict: 'event_id', ignoreDuplicates: true }
      )
      .select('event_id');
    expect(execute).toHaveBeenCalledWith('inbox_insert', {
      event_id: 'e1',
      status: 'pending',
      event_details: null,
    });
    expect(out).toEqual({ data: [{ event_id: 'e1' }], error: null });
  });

  it('reads one inbox row by key and projects the requested columns', async () => {
    const { client, execute } = setup({
      event_type: 'a',
      customer_id: 'c',
      extra: 'dropped',
    });
    const out = await client
      .from('piggyvest_webhook_inbox')
      .select('event_type, customer_id')
      .eq('event_id', 'e1')
      .maybeSingle();
    expect(execute).toHaveBeenCalledWith('inbox_read', { event_id: 'e1' });
    expect(out.data).toEqual({ event_type: 'a', customer_id: 'c' });
  });

  it('returns null data for a missing row', async () => {
    const { client } = setup(null);
    const out = await client
      .from('piggyvest_plan_wallets')
      .select('wallet_id')
      .eq('wallet_id', 'w1')
      .maybeSingle();
    expect(out).toEqual({ data: null, error: null });
  });

  it.each([
    ['piggyvest_event_quarantine', 'quarantine_insert', 'body_digest'],
    [
      'piggyvest_inflow_credits',
      'inflow_credit_insert',
      'provider_transaction_id',
    ],
    [
      'piggyvest_interest_payouts',
      'interest_payout_insert',
      'provider_payout_id',
    ],
  ])('maps %s upserts to %s', async (table, fn, key) => {
    const { client, execute } = setup([{ [key]: 'k' }]);
    const out = await client
      .from(table)
      .upsert({ [key]: 'k' } as never)
      .select(key);
    expect(execute).toHaveBeenCalledWith(fn, { [key]: 'k' });
    expect(out.data).toEqual([{ [key]: 'k' }]);
  });

  it.each([
    [
      'piggyvest_inflow_credits',
      'inflow_credit_read',
      'provider_transaction_id',
    ],
    [
      'piggyvest_interest_payouts',
      'interest_payout_read',
      'provider_payout_id',
    ],
  ])('maps %s reads to %s', async (table, fn, key) => {
    const { client, execute } = setup({ customer_id: 'c' });
    await client.from(table).select('customer_id').eq(key, 'k').maybeSingle();
    expect(execute).toHaveBeenCalledWith(fn, { [key]: 'k' });
  });

  it('maps a plan wallet status flip', async () => {
    const { client, execute } = setup([{ wallet_id: 'w1' }]);
    const out = await client
      .from('piggyvest_plan_wallets')
      .update({ status: 'ready', updated_at: 'ignored' })
      .eq('wallet_id', 'w1')
      .select('wallet_id');
    expect(execute).toHaveBeenCalledWith('plan_wallet_set_status', {
      wallet_id: 'w1',
      status: 'ready',
    });
    expect(out.data).toEqual([{ wallet_id: 'w1' }]);
  });

  it('maps an outbox terminal update only for submitted rows', async () => {
    const { client, execute } = setup([{ reference: 'r1' }]);
    await client
      .from('piggyvest_transfer_outbox')
      .update({ status: 'failed', updated_at: 'ignored' })
      .eq('reference', 'r1')
      .eq('status', 'submitted')
      .select('reference');
    expect(execute).toHaveBeenCalledWith('outbox_apply_terminal', {
      reference: 'r1',
      status: 'failed',
    });
  });

  it('refuses every query shape outside the allowlist, without touching the database', async () => {
    const { client, execute } = setup();
    const refused = [
      client.from('customers').select('id').eq('id', '1').maybeSingle(),
      client
        .from('piggyvest_interest_payouts')
        .select('net_kobo')
        .eq('wallet_id', 'w'),
      client
        .from('piggyvest_transfer_outbox')
        .update({ status: 'failed' })
        .eq('reference', 'r')
        .eq('status', 'failed')
        .select('reference'),
      client
        .from('piggyvest_webhook_inbox')
        .upsert({})
        .select('event_id, customer_id'),
      client.from('piggyvest_webhook_inbox').delete(),
    ];
    for (const query of refused) {
      const out = await query;
      expect(out.data).toBeNull();
      expect(out.error?.code).toBe('PGRST_UNSUPPORTED');
    }
    expect(execute).not.toHaveBeenCalled();
  });
});

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

describe('intake client: failures', () => {
  it('surfaces the SQLSTATE as the error code, with a generic message', async () => {
    const execute = vi.fn(async () => {
      throw new PiggyvestIntakeDbError('P0001');
    });
    const client = createPiggyvestIntakeClientFromExecutor(execute);
    const out = await client.rpc('claim_piggyvest_webhook_event', {
      p_event_id: 'e',
    });
    expect(out.data).toBeNull();
    expect(out.error).toEqual({
      code: 'P0001',
      message: 'PiggyVest intake database unavailable',
    });
  });

  it('reports a failure without a SQLSTATE as an unavailable database', async () => {
    const execute = vi.fn(async () => {
      throw new Error('boom host=secret');
    });
    const client = createPiggyvestIntakeClientFromExecutor(execute);
    const out = await client
      .from('piggyvest_webhook_inbox')
      .select('event_type')
      .eq('event_id', 'e')
      .maybeSingle();
    expect(out.error?.code).toBe('PGRST_UNAVAILABLE');
    expect(out.error?.message).not.toContain('secret');
  });
});
