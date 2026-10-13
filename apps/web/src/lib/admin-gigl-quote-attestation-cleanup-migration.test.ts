import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260902090000_allow_cleanup_expired_attested_quotes.sql'
  ),
  'utf8'
);

describe('expired attested GIGL quote cleanup migration', () => {
  it('allows deletion only for expired, unused, unselected quotes', () => {
    const trigger = sql.match(
      /CREATE OR REPLACE FUNCTION private\.prevent_attested_quote_mutation\(\)[\s\S]*?AS \$\$(?<body>[\s\S]*?)\$\$;/
    )?.groups?.body;

    expect(trigger).toBeDefined();
    expect(sql).toMatch(
      /IF TG_OP = 'DELETE'[\s\S]+OLD\.expires_at < now\(\)[\s\S]+OLD\.used IS FALSE[\s\S]+o\.selected_quote_id = OLD\.id[\s\S]+RETURN OLD;/
    );
    expect(trigger).toMatch(
      /NOT EXISTS \([\s\S]+o\.selected_quote_id = OLD\.id/
    );
    expect(trigger).toMatch(
      /NOT EXISTS \([\s\S]+c\.shipping_quote_id = OLD\.id/
    );
  });

  it('keeps attested quote updates and protected deletes immutable', () => {
    expect(sql).toContain(
      "RAISE EXCEPTION 'attested_shipping_quote_immutable'"
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.prevent_attested_quote_mutation()'
    );
    expect(sql).toContain('RETURNS trigger');
    expect(sql).toContain('FROM public.shipping_quote_attestations a');
  });

  it('prevents protected rows from aborting the cleanup batch', () => {
    expect(sql).toMatch(
      /DELETE FROM shipping_quotes sq[\s\S]+sq\.expires_at < now\(\)[\s\S]+sq\.used IS FALSE[\s\S]+o\.selected_quote_id = sq\.id/
    );
    expect(sql).toContain('c.shipping_quote_id = sq.id');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.cleanup_expired_shipping_quotes()'
    );
  });
});
