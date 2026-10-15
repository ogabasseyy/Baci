import { randomUUID } from 'node:crypto';

// Shared builders for the checkout-shipping-recovery PostgreSQL suites.
// Extracted to keep each suite under the 300-line limit.
export const RECOVERY_MERCHANT_ID = '10000000-0000-4000-8000-000000000001';
export const RECOVERY_ORDER_ID = '40000000-0000-4000-8000-000000000001';
export const RECOVERY_OWNER_ID = '20000000-0000-4000-8000-000000000001';

export function recoveryJson(value: unknown) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

export function recoveryQuote() {
  return {
    id: randomUUID(),
    merchant_id: RECOVERY_MERCHANT_ID,
    session_id: RECOVERY_ORDER_ID,
    provider: 'GIGL',
    service_tier: 'standard',
    carrier_name: 'GIG Logistics',
    price: 110,
    provider_cost: 100,
    platform_margin: 10,
    platform_margin_bps: 1000,
    pricing_version: 'gigl_platform_margin_v1',
    currency: 'NGN',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    quote_request: {
      merchantId: RECOVERY_MERCHANT_ID,
      shipmentType: 'domestic',
      receiver: {
        name: 'Test Customer',
        phone: '08000000000',
        address: '12 Test Street',
        city: 'Ikeja',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
        latitude: 6.6018,
        longitude: 3.3515,
      },
      items: [{ name: 'Phone', quantity: 1, weight: 1, value: 1000 }],
    },
  };
}

export type RecoveryQuote = ReturnType<typeof recoveryQuote>;

export function recoveryPrepare(
  value: RecoveryQuote,
  hash: string,
  signed: unknown
) {
  return `SELECT public.prepare_customer_checkout_shipping_recovery('${RECOVERY_ORDER_ID}','${hash}',${recoveryJson(value)},${recoveryJson(signed)});`;
}

export function recoveryConfirm(id: string) {
  return `SELECT public.confirm_customer_checkout_shipping_recovery('${RECOVERY_ORDER_ID}','${id}',true);`;
}

export function recoveryActorAuth(actor = RECOVERY_OWNER_ID) {
  return `SELECT set_config('request.jwt.claim.role','authenticated',true);
    SELECT set_config('request.jwt.claim.sub','${actor}',true); SET LOCAL ROLE authenticated;
    DO $actor$ BEGIN IF current_user <> 'authenticated' THEN
      RAISE EXCEPTION 'recovery actor requires an authenticated transaction';
    END IF; END $actor$;`;
}

// Condition wait with a robust timeout: polls the database until the probe
// reports true, failing explicitly on timeout instead of silently observing
// a false negative from a fixed short delay.
export async function recoveryWaitFor(
  probe: () => boolean,
  what: string,
  timeoutMs = 15000
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (probe()) return;
    if (Date.now() - startedAt > timeoutMs)
      throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
