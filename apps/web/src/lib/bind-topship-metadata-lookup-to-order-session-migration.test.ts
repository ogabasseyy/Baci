import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260905110000_bind_topship_metadata_lookup_to_order_session.sql'
  ),
  'utf8'
);

describe('bind topship metadata lookup to order session migration', () => {
  it('requires session_id to match the order when selected_quote_id is null', () => {
    expect(sql).toContain('o.selected_quote_id = sq.id');
    expect(sql).toContain('o.selected_quote_id IS NULL');
    expect(sql).toContain('sq.session_id = p_order_id::text');
    expect(sql).toMatch(
      /o\.selected_quote_id\s+IS\s+NULL\s+AND\s+sq\.session_id\s*=\s*p_order_id::text/i
    );
  });
});
