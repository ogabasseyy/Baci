import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrations = resolve(process.cwd(), '../../supabase/migrations');
const MIGRATION = '20261031220000_gigl_round_price_to_ngn_100.sql';
const read = (name: string) => readFileSync(resolve(migrations, name), 'utf8');
const sql = read(MIGRATION);

const PRICE_CHECK =
  'OR private.gigl_v1_price_matches_cost(v_cost, v_price) IS DISTINCT FROM true';

const WRITERS = [
  {
    name: 'public.persist_authenticated_admin_gigl_quote',
    previous: '20260903134000_fix_authenticated_gigl_quote_boundaries.sql',
    signature: '(jsonb, jsonb)',
  },
  {
    name: 'public.persist_refreshed_order_shipping_quote',
    previous: '20260904123300_preserve_customer_checkout_on_quote_refresh.sql',
    signature: '(uuid, jsonb)',
  },
] as const;

function definition(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const end = source.indexOf('\n$$;', start);
  if (end < 0) throw new Error(`Unterminated ${name}`);
  return source.slice(start, end + 4);
}

/** Collapse whitespace and drop comments and the expected-price check. */
function withoutPriceCheck(body: string): string {
  return body
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .replace(' v_expected_price numeric;', '')
    .replace(
      ' IF v_cost IS NOT NULL AND v_cost > 0 THEN v_expected_price := ceil((round(v_cost * 100) * 11000) / 10000.0) / 100.0; END IF;',
      ''
    )
    .replace(' OR v_expected_price IS NULL OR v_price <> v_expected_price', '')
    .replace(` ${PRICE_CHECK}`, '');
}

describe('GIGL NGN 100 price rounding migration', () => {
  it('adds an immutable private helper accepting either v1 price for a cost', () => {
    const helper = definition(sql, 'private.gigl_v1_price_matches_cost');
    expect(helper).toContain('RETURNS boolean');
    expect(helper).toContain('IMMUTABLE');
    expect(helper).toContain("SET search_path = ''");
    expect(helper).not.toContain('SECURITY DEFINER');
    expect(helper).toContain(
      'ceil((round(p_provider_cost * 100) * 11000) / 10000.0) / 100.0'
    );
    expect(helper.replace(/\s+/g, ' ')).toContain(
      'ceil(ceil((round(p_provider_cost * 100) * 11000) / 10000.0) / 10000.0) * 100'
    );
    expect(helper).toContain('p_provider_cost > 0');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION private.gigl_v1_price_matches_cost(numeric, numeric)\n  FROM PUBLIC, anon, authenticated;'
    );
  });

  it('grants nothing and keeps both 2-arg writers closed to clients', () => {
    expect(sql).not.toMatch(/\bGRANT\b/);
    for (const writer of WRITERS) {
      expect(sql).toContain(
        `REVOKE ALL ON FUNCTION ${writer.name}${writer.signature}\n  FROM PUBLIC, anon, authenticated;`
      );
    }
  });

  it.each(WRITERS)('changes only the expected-price check in $name', ({
    name,
    previous,
  }) => {
    const current = definition(sql, name);
    const before = definition(read(previous), name);
    expect(current).toContain('SECURITY DEFINER');
    expect(current).toContain("SET search_path = ''");
    expect(current.split(PRICE_CHECK)).toHaveLength(2);
    expect(current).not.toContain('v_expected_price');
    expect(current).toContain('OR v_bps <> 1000');
    expect(current).toContain('OR v_price <> v_cost + v_margin');
    expect(before).toContain('OR v_price <> v_expected_price');
    expect(withoutPriceCheck(current)).toBe(withoutPriceCheck(before));
  });

  it('is the newest definition of both writers and of the helper', () => {
    const later = readdirSync(migrations).filter(
      (name) => name.endsWith('.sql') && name > MIGRATION
    );
    for (const name of later) {
      const source = read(name);
      for (const fn of [
        ...WRITERS.map((writer) => writer.name),
        'private.gigl_v1_price_matches_cost',
      ]) {
        expect(source, `${name} redefines ${fn}`).not.toContain(
          `FUNCTION ${fn}(`
        );
      }
    }
  });
});
