// SQL and proof builders for gigl-external-waybill-link.postgres.test.ts.
// Importers must mock `server-only` and `@/env` (the proof signer) first.
import type {
  ExternalWaybillOrderSnapshot,
  FoundExternalWaybill,
} from './external-gigl-waybill-preview';
import {
  buildExternalWaybillLinkPayload,
  LINK_EXTERNAL_GIGL_WAYBILL_ACTION,
} from './persist-external-gigl-waybill';
import { giglPreShipment } from './providers/gigl.test-helpers';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

export const merchantId = '10000000-0000-4000-8000-000000000001';
export const otherMerchantId = '10000000-0000-4000-8000-000000000002';
export const ownerId = '20000000-0000-4000-8000-000000000001';
export const otherOwnerId = '20000000-0000-4000-8000-000000000002';
export const staffId = '20000000-0000-4000-8000-000000000003';
export const order = (suffix: string) =>
  `41000000-0000-4000-8000-00000000000${suffix}`;

export const lookup: FoundExternalWaybill = {
  status: 'found',
  account: { userChannelCode: 'IND000000', userId: 'gig-user' },
  preShipment: giglPreShipment({
    Waybill: '2000000001',
    ReceiverName: 'Ada Lovelace',
    ReceiverPhoneNumber: '+2348000000000',
    ReceiverAddress: 'ABAKALIKI => ABAKALIKI (CENTRAL PARK)',
    ReceiverState: 'EBONYI',
    SenderName: 'Shop',
    IsHomeDelivery: false,
    GrandTotal: 45852.2,
  }),
  tracking: null,
};

export function sqlJson(value: unknown): string {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

export function proof(
  orderId: string,
  waybill = '2000000001',
  merchant = merchantId,
  edit: (payload: Record<string, unknown>) => Record<string, unknown> = (p) =>
    p,
  snapshot: ExternalWaybillOrderSnapshot = {
    customer_name: null,
    customer_phone: null,
    phone: null,
    state: null,
  }
) {
  return createShippingQuoteRouteProof({
    action: LINK_EXTERNAL_GIGL_WAYBILL_ACTION,
    merchantId: merchant,
    subjectId: orderId,
    payload: edit(buildExternalWaybillLinkPayload(waybill, lookup, snapshot)),
  });
}

export function actor(user: string): string {
  return `SELECT set_config('request.jwt.claim.role','authenticated',true);
    SELECT set_config('request.jwt.claim.sub','${user}',true);
    SET LOCAL ROLE authenticated;`;
}

export function link(
  orderId: string,
  routeProof: unknown = proof(orderId)
): string {
  return `SELECT public.link_external_gigl_waybill('${orderId}', ${sqlJson(routeProof)}) IS NOT NULL;`;
}

export function staff(permissions: object): string {
  return `INSERT INTO public.staff_members (id, merchant_id, user_id, role, permissions, status)
    VALUES (gen_random_uuid(), '${merchantId}', '${staffId}', 'manager',
      '${JSON.stringify(permissions)}'::jsonb, 'active');`;
}

export const asPostgres = 'RESET ROLE;';
