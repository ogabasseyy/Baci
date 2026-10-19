import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260827120000_get_customer_order_transactions.sql'
  ),
  'utf8'
);

describe('customer transaction projection migration contract', () => {
  it('binds every row to the authenticated customer-owned order', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain('c.user_id = (SELECT auth.uid())');
    expect(migration).toContain(
      'coalesce(array_length(p_order_ids, 1), 0) <= 100'
    );
    expect(migration).toContain('INNER JOIN public.orders AS o');
    expect(migration).toContain('INNER JOIN public.customers AS c');
    expect(migration).toContain('t.order_id = ANY(coalesce(p_order_ids');
  });

  it('returns a bounded receipt projection without raw transaction metadata', () => {
    expect(migration).toContain('dva_account_number text');
    expect(migration).toContain("t.metadata ->> 'dva_account_number'");
    expect(migration).not.toContain('t.gateway_response');
    expect(migration).not.toMatch(/SELECT\s+\*/i);
  });

  it('exposes the function only to authenticated callers', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_customer_order_transactions(uuid[])'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_customer_order_transactions(uuid[])'
    );
    expect(migration).toContain('TO authenticated');
    expect(migration).toContain('FROM PUBLIC, anon');
  });
});
