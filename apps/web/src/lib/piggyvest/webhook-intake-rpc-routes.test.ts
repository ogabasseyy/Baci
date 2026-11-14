import { describe, expect, it } from 'vitest';
import { PIGGYVEST_WEBHOOK_INTAKE_FUNCTIONS } from './webhook-intake-executor';
import { rpcRoutes } from './webhook-intake-rpc-routes';

describe('rpcRoutes', () => {
  it('maps exactly the receiver RPC names', () => {
    expect(Object.keys(rpcRoutes).sort()).toEqual(
      [
        'allocate_plan_transfer_contribution',
        'apply_staging_wallet_restriction',
        'capture_piggyvest_webhook_delivery',
        'claim_piggyvest_webhook_event',
        'resolve_piggyvest_webhook_capture',
        'resolve_piggyvest_webhook_event',
        'resolve_staging_wallet_owner',
      ].sort()
    );
  });

  it('routes only to allowlisted restricted functions', () => {
    for (const route of Object.values(rpcRoutes)) {
      expect(PIGGYVEST_WEBHOOK_INTAKE_FUNCTIONS).toContain(route.fn);
    }
  });

  it('passes the capture command object through', () => {
    const cmd = { event_id: 'e1' };
    const r = rpcRoutes.capture_piggyvest_webhook_delivery;
    expect(r.fn).toBe('capture_delivery');
    expect(r.payload({ p_command: cmd })).toBe(cmd);
  });

  it.each([
    null,
    'x',
    5,
    [1],
    undefined,
  ])('refuses a non-object capture command %j', (p_command) => {
    expect(
      rpcRoutes.capture_piggyvest_webhook_delivery.payload({ p_command })
    ).toBeNull();
  });

  it('accepts only inline processed completion of a capture', () => {
    const r = rpcRoutes.resolve_piggyvest_webhook_capture;
    expect(r.fn).toBe('resolve_capture');
    expect(
      r.payload({
        p_id: 7,
        p_claim_token: null,
        p_state: 'processed',
        p_error: null,
      })
    ).toEqual({ id: 7, state: 'processed' });
    for (const bad of [
      { p_claim_token: 'tok', p_state: 'processed', p_error: null },
      { p_claim_token: null, p_state: 'failed', p_error: null },
      { p_claim_token: null, p_state: 'processed', p_error: 'boom' },
      { p_state: 'processed' },
    ]) {
      expect(r.payload({ p_id: 7, ...bad })).toBeNull();
    }
  });

  it('maps claim and resolve event arguments', () => {
    expect(rpcRoutes.claim_piggyvest_webhook_event.fn).toBe('claim_event');
    expect(
      rpcRoutes.claim_piggyvest_webhook_event.payload({
        p_event_id: 'e',
        junk: 1,
      })
    ).toEqual({ event_id: 'e' });
    expect(rpcRoutes.resolve_piggyvest_webhook_event.fn).toBe('resolve_event');
    expect(
      rpcRoutes.resolve_piggyvest_webhook_event.payload({
        p_event_id: 'e',
        p_claim_token: 't',
        p_status: 'processed',
        p_last_error: null,
        p_other: 1,
      })
    ).toEqual({
      event_id: 'e',
      claim_token: 't',
      status: 'processed',
      last_error: null,
    });
  });

  it('maps plan transfer allocation and drops unknown arguments', () => {
    const r = rpcRoutes.allocate_plan_transfer_contribution;
    expect(r.fn).toBe('allocate_plan_transfer');
    expect(
      r.payload({
        p_customer_id: 'c',
        p_merchant_id: 'm',
        p_amount_kobo: 100,
        p_provider_transaction_id: 't',
        p_idempotency_key: 'k',
        p_provider_wallet_id: 'w',
        p_provider_customer_id: 'pc',
        p_service_role: true,
      })
    ).toEqual({
      customer_id: 'c',
      merchant_id: 'm',
      amount_kobo: 100,
      provider_transaction_id: 't',
      idempotency_key: 'k',
      provider_wallet_id: 'w',
      provider_customer_id: 'pc',
    });
  });

  it('maps staging wallet restriction and owner resolution', () => {
    expect(rpcRoutes.apply_staging_wallet_restriction.fn).toBe(
      'apply_staging_restriction'
    );
    expect(
      rpcRoutes.apply_staging_wallet_restriction.payload({
        p_provider_wallet_id: 'w',
        p_restriction_status: 'frozen',
      })
    ).toEqual({ wallet_id: 'w', status: 'frozen' });
    expect(rpcRoutes.resolve_staging_wallet_owner.fn).toBe(
      'resolve_staging_owner'
    );
    expect(
      rpcRoutes.resolve_staging_wallet_owner.payload({
        p_provider_wallet_id: 'w',
        p_provider_customer_id: 'c',
      })
    ).toEqual({ provider_wallet_id: 'w', provider_customer_id: 'c' });
  });

  it('has no route for unknown or inherited names', () => {
    for (const name of [
      'unknown_rpc',
      'toString',
      '__proto__',
      'constructor',
    ]) {
      expect(Object.hasOwn(rpcRoutes, name)).toBe(false);
    }
  });
});
