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
    ['piggyvest_inflow_credits', 'inflow_credit_insert', 'pvb_reference'],
    ['piggyvest_interest_payouts', 'interest_payout_insert', 'pvb_reference'],
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
    ['piggyvest_inflow_credits', 'inflow_credit_read', 'pvb_reference'],
    [
      'piggyvest_inflow_credits',
      'inflow_credit_read',
      'provider_transaction_id',
    ],
    ['piggyvest_interest_payouts', 'interest_payout_read', 'pvb_reference'],
    [
      'piggyvest_interest_payouts',
      'interest_payout_read',
      'provider_payout_id',
    ],
  ])('maps %s reads to %s by %s', async (table, fn, key) => {
    const { client, execute } = setup({ customer_id: 'c' });
    await client.from(table).select('customer_id').eq(key, 'k').maybeSingle();
    expect(execute).toHaveBeenCalledWith(fn, { [key]: 'k' });
  });

  it('refuses a credit upsert that selects the legacy internal key', async () => {
    const { client, execute } = setup([]);
    const out = await client
      .from('piggyvest_inflow_credits')
      .upsert({ provider_transaction_id: 'k' } as never)
      .select('provider_transaction_id');
    expect(execute).not.toHaveBeenCalled();
    expect(out.error).toMatchObject({ code: 'PGRST_UNSUPPORTED' });
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

describe('intake client: connection lifecycle', () => {
  it('dispose closes the executor session', async () => {
    const close = vi.fn(async () => undefined);
    const execute = Object.assign(
      vi.fn(async () => []),
      { close }
    );
    const client = createPiggyvestIntakeClientFromExecutor(execute);
    await client.dispose?.();
    expect(close).toHaveBeenCalledOnce();
  });

  it('dispose is a no-op for an executor without a session', async () => {
    const { client } = setup();
    await expect(client.dispose?.()).resolves.toBeUndefined();
  });
});
