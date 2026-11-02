import { describe, expect, it } from 'vitest';
import {
  accountsBody,
  jsonResponse,
  mockSupabase,
  ROW,
  retrieveBody,
  SCOPE,
} from './plan-wallet-provisioning.test-support';

describe('plan-wallet-provisioning test support', () => {
  it('answers JSON with status 200 unless told otherwise', async () => {
    const ok = jsonResponse({ status: true });
    const processing = jsonResponse({ status: true }, 202);
    expect(ok.status).toBe(200);
    expect(processing.status).toBe(202);
    expect(await processing.json()).toEqual({ status: true });
  });

  it('describes one wallet consistently across the row, the retrieve body and the scope', () => {
    expect(ROW.wallet_id).toBe(retrieveBody.data.id);
    expect(ROW.subaccount_name).toBe(retrieveBody.data.name);
    expect(ROW.subaccount_name).toBe(
      `BACI PLAN ${SCOPE.merchantId.slice(0, 8)} ${SCOPE.customerId.slice(0, 8)}`.toUpperCase()
    );
    expect(accountsBody.data[0].account_number).toMatch(/^\d{10}$/);
  });

  it('replays queued Supabase reads in order and records upserts', async () => {
    const { client, upsert } = mockSupabase({
      singles: [
        { data: null, error: null },
        { data: ROW, error: null },
      ],
    });
    const query = client.from('piggyvest_plan_wallets').select('wallet_id');
    expect(await query.maybeSingle()).toEqual({ data: null, error: null });
    expect(await query.maybeSingle()).toEqual({ data: ROW, error: null });
    await client.from('piggyvest_plan_wallets').upsert({ wallet_id: 'w' });
    expect(upsert).toHaveBeenCalledWith({ wallet_id: 'w' });
  });
});
