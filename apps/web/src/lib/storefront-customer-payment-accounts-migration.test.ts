import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828001000_get_customer_order_payment_accounts.sql'
  ),
  'utf8'
);

describe('customer payment-account projection migration contract', () => {
  it('binds every row to the authenticated customer-owned order', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain('customer.user_id = (SELECT auth.uid())');
    expect(migration).toContain(
      'coalesce(array_length(p_order_ids, 1), 0) <= 100'
    );
    expect(migration).toContain(
      'INNER JOIN public.orders AS order_row ON order_row.id = account.order_id'
    );
    expect(migration).toContain(
      'INNER JOIN public.customers AS customer ON customer.id = order_row.customer_id'
    );
    expect(migration).toContain('account.order_id = ANY(coalesce(p_order_ids');
  });

  it('returns only the receipt account projection', () => {
    expect(migration).toContain('assignment_customer_email_source text');
    expect(migration).not.toContain('payable_amount');
    expect(migration).not.toContain('assignment_customer_email text');
    expect(migration).not.toMatch(/SELECT\s+\*/i);
  });

  it('exposes the function only to authenticated callers', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_customer_order_payment_accounts(uuid[])'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_customer_order_payment_accounts(uuid[])'
    );
    expect(migration).toContain('TO authenticated');
    expect(migration).toContain('FROM PUBLIC, anon');
  });
});
