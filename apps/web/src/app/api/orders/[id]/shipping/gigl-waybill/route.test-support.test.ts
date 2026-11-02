import { describe, expect, it } from 'vitest';
import { createSupabase, linkableTables } from './route.test-support';

describe('route test support', () => {
  it('answers each table query in order and fails on unexpected ones', async () => {
    const { supabase } = createSupabase(linkableTables());
    const first = await supabase.from('orders').select('id').maybeSingle();
    expect(first.data).toMatchObject({ order_number: 'ORD-291026-TEST' });
    expect(() => supabase.from('customers').select('id').maybeSingle()).toThrow(
      'Unexpected query on customers'
    );
  });
});
