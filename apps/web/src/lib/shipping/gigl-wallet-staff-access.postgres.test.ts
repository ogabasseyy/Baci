import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGiglWalletStaffAccessTestDatabase } from '../../../../../supabase/tests/gigl-wallet-staff-access-test-harness.mjs';

const merchantId = '10000000-0000-4000-8000-000000000001';
const otherMerchantId = '10000000-0000-4000-8000-000000000002';
const ownerId = '20000000-0000-4000-8000-000000000001';
const staffId = '20000000-0000-4000-8000-000000000003';
const bindOrderId = '40000000-0000-4000-8000-000000000001';
const bindQuoteId = '70000000-0000-4000-8000-000000000001';
const walletOrderId = '40000000-0000-4000-8000-000000000002';
const walletQuoteId = '70000000-0000-4000-8000-000000000002';
const requestId = '80000000-0000-4000-8000-000000000001';
const receiver = `'{"name":"Ada","phone":"08000000000","address":"12 Test Street","city":"Ikeja","state":"Lagos"}'::jsonb`;

const fulfil = { orders: { view: true, fulfill: true } };
const fulfilEdit = { orders: { view: true, fulfill: true, edit: true } };
const editOnly = { orders: { view: true, edit: true } };

function staff(
  permissions: object,
  status = 'active',
  merchant = merchantId
): string {
  return `INSERT INTO public.staff_members (id, merchant_id, user_id, role, permissions, status)
    VALUES (gen_random_uuid(), '${merchant}', '${staffId}', 'manager',
      '${JSON.stringify(permissions)}'::jsonb, '${status}');`;
}
function actor(user: string): string {
  return `SELECT set_config('request.jwt.claim.role','authenticated',true);
    SELECT set_config('request.jwt.claim.sub','${user}',true);
    SET LOCAL ROLE authenticated;`;
}
const balance = `SELECT public.get_merchant_shipping_wallet_balance('${merchantId}');`;
const reserve = `SELECT status FROM public.reserve_merchant_shipping_charge('${walletOrderId}','${walletQuoteId}','attempt-token');`;
const bind = `SELECT available_balance FROM public.bind_admin_gigl_quote('${bindOrderId}','${merchantId}','${bindQuoteId}',${receiver});`;

describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'GIG merchant-wallet access for orders.fulfill staff',
  () => {
    const database = createGiglWalletStaffAccessTestDatabase();
    beforeAll(() => database.start(), 60000);
    afterAll(() => database.stop());
    const run = (sql: string) =>
      database.query(`BEGIN; ${sql} ROLLBACK;`).trim().split('\n');
    const last = (sql: string) => run(sql).at(-1);

    it.each([
      'public.get_merchant_shipping_wallet_balance(uuid)',
      'public.get_merchant_wallet_funding_account(uuid)',
      'public.bind_admin_gigl_quote(uuid,uuid,uuid,jsonb)',
      'public.reserve_merchant_shipping_charge(uuid,uuid,text)',
      'public.fail_merchant_wallet_funding_request(uuid,uuid)',
    ])('grants EXECUTE on %s to authenticated only', (signature) => {
      expect(
        last(`SELECT has_function_privilege('authenticated','${signature}','EXECUTE'),
          has_function_privilege('anon','${signature}','EXECUTE'),
          EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL
            pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
            WHERE p.oid='${signature}'::regprocedure AND a.grantee=0);`)
      ).toBe('t|f|f');
    });

    it('shows the balance to the owner and to orders.fulfill staff', () => {
      expect(last(`${actor(ownerId)} ${balance}`)).toBe('500');
      expect(last(`${staff(fulfil)} ${actor(staffId)} ${balance}`)).toBe('500');
    });

    it.each([
      ['orders.edit-only staff', staff(editOnly)],
      ['pending orders.fulfill staff', staff(fulfil, 'pending')],
      ['removed orders.fulfill staff', staff(fulfil, 'removed')],
      ['another merchant’s staff', staff(fulfil, 'active', otherMerchantId)],
    ])('denies the balance to %s', (_label, setup) => {
      expect(() => run(`${setup} ${actor(staffId)} ${balance}`)).toThrow(
        /merchant_shipping_wallet_balance_forbidden/
      );
    });

    it('projects only safe funding-account columns to orders.fulfill staff', () => {
      const row = last(`${staff(fulfil)} ${actor(staffId)}
        SELECT row_to_json(a) FROM public.get_merchant_wallet_funding_account('${merchantId}') a;`);
      expect(JSON.parse(row ?? '{}')).toEqual({
        account_name: 'Shop',
        account_number: '1234567890',
        bank_name: 'Bank',
        currency: 'NGN',
        status: 'active',
      });
      expect(() =>
        run(`${staff(editOnly)} ${actor(staffId)}
          SELECT * FROM public.get_merchant_wallet_funding_account('${merchantId}');`)
      ).toThrow(/merchant_wallet_funding_account_forbidden/);
    });

    it('lets orders.fulfill staff read and create a pending funding request', () => {
      const output = run(`${staff(fulfil)} ${actor(staffId)}
        SELECT count(*) FROM public.merchant_wallet_funding_account_requests;
        INSERT INTO public.merchant_wallet_funding_account_requests (merchant_id, status)
          VALUES ('${merchantId}', 'pending') RETURNING status || '|' || requested_by;`);
      expect(output.slice(-2)).toEqual(['1', `pending|${staffId}`]);
    });

    it('refuses a funding request that names someone else as the requester', () => {
      expect(() =>
        run(`${staff(fulfil)} ${actor(staffId)}
          INSERT INTO public.merchant_wallet_funding_account_requests
            (merchant_id, status, requested_by)
            VALUES ('${merchantId}', 'pending', '${ownerId}');`)
      ).toThrow(/row-level security/);
    });

    it('keeps funding requests closed to staff without orders.fulfill', () => {
      expect(
        last(`${staff(editOnly)} ${actor(staffId)}
          SELECT count(*) FROM public.merchant_wallet_funding_account_requests;`)
      ).toBe('0');
      expect(() =>
        run(`${staff(editOnly)} ${actor(staffId)}
          INSERT INTO public.merchant_wallet_funding_account_requests (merchant_id)
            VALUES ('${merchantId}');`)
      ).toThrow(/row-level security/);
      expect(() =>
        run(`${staff(fulfil)} ${actor(staffId)}
          INSERT INTO public.merchant_wallet_funding_account_requests (merchant_id, status)
            VALUES ('${merchantId}', 'fulfilled');`)
      ).toThrow(/row-level security/);
    });

    it('lets orders.fulfill staff fail a stuck request, but not edit-only staff', () => {
      const failed = `SELECT public.fail_merchant_wallet_funding_request('${requestId}','${merchantId}');
        RESET ROLE; SELECT status FROM public.merchant_wallet_funding_account_requests
          WHERE id='${requestId}';`;
      expect(last(`${staff(fulfil)} ${actor(staffId)} ${failed}`)).toBe(
        'failed'
      );
      expect(() =>
        run(`${staff(editOnly)} ${actor(staffId)} ${failed}`)
      ).toThrow(/merchant_fulfill_required/);
    });

    it('admits orders.fulfill staff to HMAC funding recovery before attestation checks', () => {
      const complete = `SELECT public.complete_merchant_wallet_funding_recovery(
        '${requestId}','${merchantId}','1234567890','Shop','Bank','NGN',NULL,NULL,
        now() - interval '1 day', (now() - interval '1 day')::text, 'bad');`;
      expect(() =>
        run(`${staff(fulfil)} ${actor(staffId)} ${complete}`)
      ).toThrow(/attestation_expired/);
      expect(() =>
        run(`${staff(editOnly)} ${actor(staffId)} ${complete}`)
      ).toThrow(/forbidden/);
    });

    it('lets the owner and orders.fulfill + orders.edit staff bind the attested quote', () => {
      const bound = `RESET ROLE; SELECT shipping_funding_source || '|' || selected_quote_id
        FROM public.orders WHERE id='${bindOrderId}';`;
      const owner = run(`${actor(ownerId)} ${bind} ${bound}`);
      expect(owner.slice(-2)).toEqual([
        '500',
        `merchant_wallet|${bindQuoteId}`,
      ]);
      const output = run(
        `${staff(fulfilEdit)} ${actor(staffId)} ${bind} ${bound}`
      );
      expect(output.slice(-2)).toEqual([
        '500',
        `merchant_wallet|${bindQuoteId}`,
      ]);
    });

    it.each([
      ['orders.fulfill without orders.edit', fulfil],
      ['orders.edit without orders.fulfill', editOnly],
    ])('keeps binding closed to staff with %s', (_label, grants) => {
      expect(() => run(`${staff(grants)} ${actor(staffId)} ${bind}`)).toThrow(
        /forbidden/
      );
    });

    it('lets orders.fulfill + orders.edit staff create one capped, attributed debit', () => {
      const output = run(`${staff(fulfilEdit)} ${actor(staffId)} ${reserve}
        RESET ROLE;
        SELECT available_balance FROM public.merchant_wallets WHERE merchant_id='${merchantId}';
        SELECT count(*) || '|' || sum(amount) FROM public.wallet_transactions
          WHERE source_id='${walletOrderId}' AND type='debit';
        SELECT reserved_by FROM public.merchant_shipping_charges
          WHERE order_id='${walletOrderId}';`);
      expect(output.slice(-4)).toEqual(['reserved', '390', '1|110', staffId]);
    });

    it('records the owner as the actor on an owner debit', () => {
      const output = run(`${actor(ownerId)} ${reserve} RESET ROLE;
        SELECT reserved_by FROM public.merchant_shipping_charges
          WHERE order_id='${walletOrderId}';`);
      expect(output.at(-1)).toBe(ownerId);
    });

    it.each([
      ['orders.fulfill without orders.edit', fulfil],
      ['orders.edit without orders.fulfill', editOnly],
    ])('refuses a new debit for staff with %s but lets them resume one', (_label, grants) => {
      expect(() =>
        run(`${staff(grants)} ${actor(staffId)} ${reserve}`)
      ).toThrow(/wallet_reservation_fulfill_edit_required/);
      const resumed = run(`${actor(ownerId)} ${reserve} RESET ROLE;
        ${staff(grants)} ${actor(staffId)} ${reserve}
        RESET ROLE; SELECT count(*) || '|' || min(reserved_by::text)
          FROM public.merchant_shipping_charges;
        SELECT count(*) FROM public.wallet_transactions;`);
      expect(resumed.slice(-2)).toEqual([`1|${ownerId}`, '1']);
    });

    it('refuses view-only staff and an insufficient wallet', () => {
      expect(() =>
        run(`${staff({ orders: { view: true } })} ${actor(staffId)} ${reserve}`)
      ).toThrow(/order_not_owned/);
      expect(() =>
        run(`UPDATE public.merchant_wallets SET available_balance=50;
          ${staff(fulfilEdit)} ${actor(staffId)} ${reserve}`)
      ).toThrow(/MERCHANT_WALLET_INSUFFICIENT/);
    });
  }
);
