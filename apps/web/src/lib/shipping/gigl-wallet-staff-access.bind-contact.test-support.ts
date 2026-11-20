import { describe, expect, it } from 'vitest';

type BindContactFallbackContext = {
  run: (sql: string) => string[];
  actor: (user: string) => string;
  bind: string;
  bindOrderId: string;
  bindQuoteId: string;
  merchantId: string;
  ownerId: string;
};

// Registers the bind_admin_gigl_quote contact-fallback cases inside the
// gigl-wallet-staff-access PostgreSQL suite (kept separate for the 300-line
// file limit; the suite file is the one wired into CI).
export function describeBindContactFallback({
  run,
  actor,
  bind,
  bindOrderId,
  bindQuoteId,
  merchantId,
  ownerId,
}: BindContactFallbackContext): void {
  describe('bugfix: bind 409 when shipping_address lacks name/phone', () => {
    const noContact = `RESET ROLE;
      UPDATE public.orders SET customer_name='Ada', customer_phone='08000000000',
        shipping_address='{"address":"12 Test Street","city":"Ikeja","state":"Lagos"}'
        WHERE id='${bindOrderId}';`;
    const bound = `RESET ROLE; SELECT shipping_funding_source FROM public.orders WHERE id='${bindOrderId}';`;

    it('binds when name/phone only exist on customer_name/customer_phone', () => {
      const out = run(`${noContact} ${actor(ownerId)} ${bind} ${bound}`);
      expect(out.at(-1)).toBe('merchant_wallet');
    });

    it('still refuses when the stored address really changed', () => {
      expect(() =>
        run(`${noContact}
          UPDATE public.orders SET shipping_address=shipping_address || '{"address":"99 Other Road"}' WHERE id='${bindOrderId}';
          ${actor(ownerId)} ${bind}`)
      ).toThrow(/stale_order_quote_inputs/);
    });

    it('still refuses when the customer phone differs from the quoted receiver', () => {
      expect(() =>
        run(`${noContact}
          UPDATE public.orders SET customer_phone='09011111111' WHERE id='${bindOrderId}';
          ${actor(ownerId)} ${bind}`)
      ).toThrow(/stale_order_quote_inputs/);
    });

    it('still refuses when the customer name differs from the quoted receiver', () => {
      expect(() =>
        run(`${noContact}
          UPDATE public.orders SET customer_name='Other Person' WHERE id='${bindOrderId}';
          ${actor(ownerId)} ${bind}`)
      ).toThrow(/stale_order_quote_inputs/);
    });

    it('falls back to customer_name when shipping_address.name is blank whitespace', () => {
      const out = run(`RESET ROLE;
        UPDATE public.orders SET customer_name='Ada', customer_phone='08000000000',
          shipping_address='{"name":"   ","address":"12 Test Street","city":"Ikeja","state":"Lagos"}'
          WHERE id='${bindOrderId}';
        ${actor(ownerId)} ${bind} ${bound}`);
      expect(out.at(-1)).toBe('merchant_wallet');
    });

    it('prefers shipping_address name and phone over divergent customer fields', () => {
      const out = run(`RESET ROLE;
        UPDATE public.orders SET customer_name='Other', customer_phone='09099999999',
          shipping_address='{"name":"Ada","phone":"08000000000","address":"12 Test Street","city":"Ikeja","state":"Lagos"}'
          WHERE id='${bindOrderId}';
        ${actor(ownerId)} ${bind} ${bound}`);
      expect(out.at(-1)).toBe('merchant_wallet');
    });

    // The quote builder (readContactText) and this compare must read the
    // stored contact identically: JSON strings and numbers only, blanks
    // removed with btrim (ASCII spaces only).
    const quoted = (contact: object) => ({
      name: 'Ada',
      phone: '08000000000',
      address: '12 Test Street',
      city: 'Ikeja',
      state: 'Lagos',
      ...contact,
    });
    const storeAddress = (address: object) =>
      `UPDATE public.orders SET customer_name='Ada', customer_phone='08000000000',
        shipping_address='${JSON.stringify(address)}'::jsonb WHERE id='${bindOrderId}';`;
    const quoteReceiver = (value: object) => {
      const json = `'${JSON.stringify(value)}'::jsonb`;
      return `UPDATE public.shipping_quotes SET quote_request = jsonb_set(quote_request, '{receiver}', ${json}) WHERE id='${bindQuoteId}';
        UPDATE public.shipping_quote_attestations SET quote_request = jsonb_set(quote_request, '{receiver}', ${json}) WHERE quote_id='${bindQuoteId}';
        SELECT 1;`;
    };
    const bindReceiver = (value: object) =>
      `SELECT available_balance FROM public.bind_admin_gigl_quote('${bindOrderId}','${merchantId}','${bindQuoteId}','${JSON.stringify(value)}'::jsonb);`;

    it('binds when the stored phone is a JSON number that matches the quoted receiver text', () => {
      const numeric = quoted({ phone: '8012345678' });
      const out = run(`RESET ROLE;
        ${storeAddress({ ...numeric, phone: 8012345678 })}
        UPDATE public.orders SET customer_phone='09099999999' WHERE id='${bindOrderId}';
        ${quoteReceiver(numeric)}
        ${actor(ownerId)} ${bindReceiver(numeric)} ${bound}`);
      expect(out.at(-1)).toBe('merchant_wallet');
    });

    it.each([
      ['boolean', true],
      ['object', { digits: '08000000000' }],
      ['array', ['08000000000']],
    ])('ignores a %s stored phone and uses customer_phone like the builder', (_label, phone) => {
      const out = run(`RESET ROLE;
        ${storeAddress(quoted({ phone }))}
        ${actor(ownerId)} ${bind} ${bound}`);
      expect(out.at(-1)).toBe('merchant_wallet');
    });

    it('ignores an object stored name and uses customer_name like the builder', () => {
      const out = run(`RESET ROLE;
        ${storeAddress(quoted({ name: { first: 'Ada' } }))}
        ${actor(ownerId)} ${bind} ${bound}`);
      expect(out.at(-1)).toBe('merchant_wallet');
    });

    it('binds when the stored phone has a trailing tab that the receiver keeps', () => {
      const tabbed = quoted({ phone: '08000000000\t' });
      const out = run(`RESET ROLE;
        ${storeAddress(tabbed)}
        ${quoteReceiver(tabbed)}
        ${actor(ownerId)} ${bindReceiver(tabbed)} ${bound}`);
      expect(out.at(-1)).toBe('merchant_wallet');
    });

    it('refuses when the receiver stripped a tab that btrim keeps on the stored phone', () => {
      expect(() =>
        run(`RESET ROLE;
          ${storeAddress(quoted({ phone: '08000000000\t' }))}
          ${actor(ownerId)} ${bind}`)
      ).toThrow(/stale_order_quote_inputs/);
    });
  });
}
