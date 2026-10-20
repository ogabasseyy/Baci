import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { definesOrPatchesStorefrontOrderRpc } from './storefront-order-rpc-migration.test-support';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(
  currentDirectory,
  '../../../../../supabase/migrations'
);
const migrationFilePattern = /^\d{14}.*\.sql$/;
const storefrontOrderRpcNamePattern = String.raw`(?:(?:"public"|public)\s*\.\s*(?:"create_storefront_order"|create_storefront_order)|(?:"create_storefront_order"|create_storefront_order))`;
const storefrontOrderRpcDefinitionPattern = new RegExp(
  String.raw`CREATE\s+OR\s+REPLACE\s+FUNCTION\s+${storefrontOrderRpcNamePattern}\s*\(`,
  'i'
);
const ambiguousCustomerConflictTargetPattern =
  /ON\s+CONFLICT\s*\(\s*merchant_id\s*,\s*email\s*\)/i;
// Signature history: the migration must remove the 19-arg B3 overload,
// the 21-arg initial B3.5 overload, and the 22-arg parity-check overload.
const EXPECTED_CREATE_STOREFRONT_ORDER_DROP_COUNT = 3;

function readLatestStorefrontOrderRpcMigrationSql(options?: {
  unsliced?: boolean;
}) {
  for (const fileName of readdirSync(migrationsDirectory)
    .filter(
      (file) =>
        migrationFilePattern.test(file) &&
        !file.includes('fix_create_storefront_order')
    )
    .sort()
    .reverse()) {
    const sql = readFileSync(resolve(migrationsDirectory, fileName), 'utf8');
    if (definesOrPatchesStorefrontOrderRpc(sql)) {
      if (options?.unsliced) {
        return sql;
      }
      const rpcIndex = sql.search(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:private|public)\.create_storefront_order\s*\(/i
      );
      return rpcIndex > -1 ? sql.slice(rpcIndex) : sql;
    }
  }

  throw new Error('No create_storefront_order migration found');
}

function readLatestPaymentReferenceHotfixSql() {
  for (const fileName of readdirSync(migrationsDirectory)
    .filter(
      (file) =>
        migrationFilePattern.test(file) &&
        file.includes('payment_reference_reuse')
    )
    .sort()
    .reverse()) {
    return readFileSync(resolve(migrationsDirectory, fileName), 'utf8');
  }

  throw new Error('No payment_reference reuse hotfix migration found');
}

function readLatestCreditDirectSessionMigrationSql() {
  const pattern =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:"public"\.|public\.)?(?:"set_credit_direct_session"|set_credit_direct_session)\s*\(/i;
  for (const fileName of readdirSync(migrationsDirectory)
    .filter((file) => migrationFilePattern.test(file))
    .sort()
    .reverse()) {
    const sql = readFileSync(resolve(migrationsDirectory, fileName), 'utf8');
    if (pattern.test(sql)) {
      return sql;
    }
  }
  throw new Error('No set_credit_direct_session migration found');
}

describe('agentic storefront order RPC contract', () => {
  it('replaces the latest RPC explicitly instead of patching function text dynamically', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    expect(sql).toMatch(storefrontOrderRpcDefinitionPattern);
    expect(sql).not.toContain('pg_get_functiondef');
    expect(sql).not.toContain('EXECUTE v_updated_definition');
  });

  it('does not write absent orders.payment_reference during pending-order reuse', () => {
    const sql = readLatestPaymentReferenceHotfixSql();

    expect(sql).toMatch(storefrontOrderRpcDefinitionPattern);
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.prepare_storefront_order_for_checkout/i
    );
    expect(sql).toMatch(
      /orders table intentionally does not have payment_reference/
    );
    expect(sql).toContain('transactions/checkout_sessions');
    expect(sql).not.toMatch(/payment_reference\s*=\s*NULL/i);
  });

  it('keeps latest RPC agentic checkout buyers guest-scoped while preserving standard auth binding', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    const agenticGuardIndex = sql.indexOf(
      'IF public.is_agentic_checkout_context() THEN'
    );
    const nullUserIndex = sql.indexOf('p_user_id := NULL;', agenticGuardIndex);
    const standardAuthIndex = sql.indexOf(
      'ELSIF v_user_id IS NOT NULL THEN',
      nullUserIndex
    );

    expect(agenticGuardIndex).toBeGreaterThan(-1);
    expect(nullUserIndex).toBeGreaterThan(agenticGuardIndex);
    expect(standardAuthIndex).toBeGreaterThan(nullUserIndex);
    expect(sql).toContain('p_user_id := v_user_id;');
    expect(sql).toContain("RAISE EXCEPTION 'user_id_mismatch';");
    expect(sql).toContain("RAISE EXCEPTION 'cannot_set_user_id_anonymously';");
    expect(sql).toMatch(
      /INSERT INTO (?:public\.)?customers \([\s\S]*user_id[\s\S]*p_user_id/
    );
  });

  // B2 (Δ-9): the named `ON CONFLICT ON CONSTRAINT` approach was
  // replaced with a retry-on-unique_violation loop that catches ALL
  // four customer unique indexes (email, lower(email), user_id,
  // phone). The output-column-ambiguity concern that motivated the
  // named constraint is moot because B2 no longer uses an ON CONFLICT
  // clause at all — INSERT raises, the EXCEPTION block re-SELECTs,
  // and UPDATE writes to the winner's row.
  it('replaces the named ON CONFLICT with a retry-on-unique_violation loop and avoids output-column ambiguity', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    expect(sql).toMatch(storefrontOrderRpcDefinitionPattern);
    expect(sql).not.toContain(
      'ON CONFLICT ON CONSTRAINT customers_merchant_id_email_key'
    );
    expect(sql).not.toMatch(ambiguousCustomerConflictTargetPattern);
    expect(sql).toContain('EXCEPTION WHEN unique_violation THEN');
    expect(sql).toContain("RAISE EXCEPTION 'customer_upsert_failed'");
  });

  it('resolves authenticated customers by user before unbound guest phone fallback', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    const userLookupIndex = sql.indexOf('AND c.user_id = p_user_id');
    const phoneLookupIndex = sql.indexOf(
      'AND c.phone = v_normalized_customer_phone'
    );
    // B2 wraps the INSERT in a retry loop, so the literal "INSERT
    // INTO customers" first appears inside that loop. Still must
    // come after the user_id + phone SELECTs.
    const customerInsertIndex = sql.search(
      /INSERT\s+INTO\s+(?:public\.)?customers/i
    );

    expect(userLookupIndex).toBeGreaterThan(-1);
    expect(phoneLookupIndex).toBeGreaterThan(-1);
    expect(customerInsertIndex).toBeGreaterThan(-1);
    expect(userLookupIndex).toBeLessThan(phoneLookupIndex);
    expect(phoneLookupIndex).toBeLessThan(customerInsertIndex);
    // Δ-97 / Codex P1: phone-only fallback is restricted to GUEST
    // checkouts (p_user_id IS NULL). Phone numbers are recycled by
    // telcos (NIST SP 800-63B AAL1); auto-claiming an existing
    // customer row from an authed checkout based on phone alone
    // would let one auth user inherit a stranger's order history.
    expect(sql).toMatch(
      /IF\s+v_customer_id\s+IS\s+NULL\s+AND\s+v_normalized_customer_phone\s+IS\s+NOT\s+NULL\s+AND\s+p_user_id\s+IS\s+NULL/i
    );
    expect(sql).toContain('AND c.user_id IS NULL');
    expect(sql).toContain(
      "v_normalized_customer_phone TEXT := NULLIF(trim(COALESCE(p_customer_phone, '')), '')"
    );
    expect(sql).toContain('v_customer_record_phone,');
    // B2 dropped the ON CONFLICT EXCLUDED path; the phone-conflict
    // skip preflight (NULL out phone if another customer owns it)
    // is what now keeps the retry loop from spinning on phone races.
    expect(sql).toContain(
      'AND existing_phone.phone = v_normalized_customer_phone'
    );
  });

  // Δ-97 / Codex P1 regression: prevents the phone-recycling
  // identity-merge from creeping back in. Phone numbers are recycled
  // by telcos every ~90 days (NIST SP 800-63B AAL1, OWASP ASVS L1
  // §6.5.4 "do not link accounts based on unverified attributes").
  it('does not auto-claim a customer row via phone fallback for an authenticated checkout (Δ-97)', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // Phone fallback IF must include `AND p_user_id IS NULL`.
    expect(sql).toMatch(
      /AND\s+v_normalized_customer_phone\s+IS\s+NOT\s+NULL\s+AND\s+p_user_id\s+IS\s+NULL/i
    );

    // Pin the comment so a future cleanup doesn't quietly strip the
    // guard along with its justification.
    expect(sql).toContain('Codex P1');
    expect(sql).toContain('Phone numbers are recycled by');

    // The UPDATE branch still auto-claims a user_id when the matched
    // row has c.user_id IS NULL — that's correct for email-matched
    // and user-id-matched rows. The Δ-97 guard ensures phone never
    // feeds rows into that branch for authed users.
    expect(sql).toContain('WHEN c.user_id IS NULL THEN p_user_id');
  });

  // Δ-98 / Jules High regression: PL/pgSQL `NULL + 1 = NULL` and
  // `NULL > 3 = NULL` (falsy), so an uninitialized retry counter
  // would silently disable the > 3 exit condition and spin forever.
  // The inline `v_retry_attempt := 0;` before the LOOP is the
  // primary safety; the DECLARE-level `INT := 0` is belt-and-braces
  // against a future refactor accidentally bypassing the inline
  // assignment.
  it('initializes the retry counter to 0 in DECLARE to rule out NULL-math infinite loops (Δ-98)', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();
    expect(sql).toContain('v_retry_attempt INT := 0;');
  });

  it('does not write a conflicting phone to a new customer record', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    expect(sql).toContain('v_customer_record_phone TEXT;');
    expect(sql).toContain(
      'v_customer_record_phone := v_normalized_customer_phone;'
    );
    expect(sql).toContain('IF v_normalized_customer_phone IS NOT NULL');
    expect(sql).toContain('v_customer_record_phone := NULL;');
    expect(sql).toContain('WHERE existing_phone.merchant_id = p_merchant_id');
    expect(sql).toContain(
      'AND existing_phone.phone = v_normalized_customer_phone'
    );
  });

  it('serializes same-phone customer resolution and applies stock updates in a deterministic order', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    expect(sql).toContain('PERFORM pg_advisory_xact_lock(');
    expect(sql).toContain('hashtext(p_merchant_id::text)');
    expect(sql).toContain('hashtext(v_normalized_customer_phone)');
    expect(sql).toContain('ORDER BY t.product_id, t.variant_id');
  });

  it('covers storefront checkout idempotency SQL contract', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql({ unsliced: true });

    expect(sql).toMatch(/checkout_idempotency_key\s+text/i);
    expect(sql).toMatch(/checkout_request_hash\s+text/i);
    expect(sql).toMatch(/idempotency_replayed\s+boolean/i);
    const orderDropMatches = sql.match(
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.create_storefront_order/gi
    );
    expect(orderDropMatches).not.toBeNull();
    expect(orderDropMatches?.length).toBeGreaterThanOrEqual(
      EXPECTED_CREATE_STOREFRONT_ORDER_DROP_COUNT
    );
    expect(sql).toMatch(
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.create_storefront_order_with_savings/i
    );
    expect(sql).toMatch(/checkout_idempotency_conflict/i);
    expect(sql).toMatch(/order_not_reusable/i);
    expect(sql).toMatch(/IF\s+FOUND\s+THEN/i);
    expect(sql).toMatch(/payment_method\s*=\s*trim\(p_payment_method\)/i);
    expect(sql).not.toMatch(/payment_reference\s*=\s*NULL/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(
      /create_storefront_order_with_savings[\s\S]*p_checkout_idempotency_key\s+text/i
    );
    expect(sql).toMatch(
      /create_storefront_order_with_savings[\s\S]*p_checkout_request_hash\s+text/i
    );
    expect(sql).toMatch(
      /create_storefront_order_with_savings[\s\S]*idempotency_replayed\s+boolean/i
    );
    expect(sql).toMatch(
      /prepare_storefront_order_for_checkout[\s\S]*bnpl_approved[\s\S]*refunded/i
    );
  });

  it('clears stale Credit Direct transaction references when a new session starts', () => {
    const sql = readLatestCreditDirectSessionMigrationSql();

    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.set_credit_direct_session/i
    );
    expect(sql).toContain(
      "v_notes - 'creditDirectTransactionId' - 'credit_directTransactionId'"
    );
  });
});

// B2 (Δ-9): defense-in-depth checks on the new retry-on-unique_violation
// path. These guard against accidentally reverting the customer upsert
// hardening that closed the Efosa-style `idx_customers_merchant_user`
// race. Each assertion targets a specific layer:
//   - advisory locks on (merchant, user_id) and (merchant, email)
//     serialize same-identity concurrent inserts
//   - the retry loop has a bounded counter so a runaway race can't
//     spin forever
//   - the EXCEPTION block re-SELECTs by user_id OR email and UPDATEs
//     defensively, never re-throws on unique_violation until the
//     counter exhausts
describe('agentic storefront order RPC contract — B2 customer upsert hardening', () => {
  it('acquires advisory locks on (merchant, user_id) and (merchant, email) before the customer upsert', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // The user_id lock is conditional (only when p_user_id IS NOT NULL).
    expect(sql).toMatch(
      /IF p_user_id IS NOT NULL THEN\s+PERFORM pg_advisory_xact_lock\(\s+hashtextextended\(p_merchant_id::text \|\| ':' \|\| p_user_id::text, 0\)/
    );
    // The email lock is unconditional.
    expect(sql).toContain(
      "p_merchant_id::text || ':' || v_normalized_customer_email, 1"
    );
  });

  it('runs the INSERT inside a bounded retry loop with a re-SELECT fallback', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // Retry counter declared and incremented; cap at 3.
    expect(sql).toContain('v_retry_attempt INT');
    expect(sql).toContain('v_retry_attempt := v_retry_attempt + 1;');
    expect(sql).toContain('IF v_retry_attempt > 3 THEN');

    // EXCEPTION block sets v_customer_id := NULL then re-SELECTs.
    expect(sql).toContain('EXCEPTION WHEN unique_violation THEN');
    // Re-SELECT must check BOTH user_id and email so any of the four
    // unique indexes that tripped can be recovered.
    expect(sql).toMatch(
      /\(p_user_id IS NOT NULL AND c\.user_id = p_user_id\)\s+OR lower\(c\.email\) = v_normalized_customer_email/
    );
  });

  it('exits the loop after a defensive UPDATE on the winner row, not by re-throwing', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // The retry path UPDATEs the visible-winner row with COALESCE'd
    // identity fields (phone, user_id, first/last name, email) so a
    // peer's partial row gets backfilled by our request's data.
    expect(sql).toMatch(
      /UPDATE (?:public\.)?customers c\s+SET\s+phone = COALESCE\(c\.phone, v_customer_record_phone\),\s+user_id = COALESCE\(c\.user_id, p_user_id\)/
    );
    // EXIT after a successful winner-row UPDATE so we don't spin.
    expect(sql).toMatch(
      /UPDATE (?:public\.)?customers c[\s\S]*?WHERE c\.id = v_customer_id;\s+EXIT;\s+END IF;/
    );
  });

  it('preserves the phone-conflict-skip preflight so the retry loop never spins on phone races', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // Before the retry loop, the insert-path NULLs out the phone if
    // another customer in the same merchant already owns it.
    expect(sql).toMatch(
      /v_customer_record_phone := v_normalized_customer_phone;[\s\S]*?IF v_normalized_customer_phone IS NOT NULL[\s\S]*?v_customer_record_phone := NULL;/
    );
  });
});

// B3 (plan §5 B3): fail-closed for missing shipping quote. The RPC must
// raise `shipping_quote_required` when a shipping provider is supplied
// without an accompanying quote id — closes the legacy `|| 'GIGL'`
// silent-default bug at apps/web/src/app/checkout/page.tsx:1217.
describe('agentic storefront order RPC contract — B3 shipping_quote_required', () => {
  it('raises shipping_quote_required when shipping_provider is set without a quote id', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // Predicate must be exactly the plan's contract: provider non-null
    // AND quote id null. Refusing a stricter predicate (e.g. checking
    // shipping_fee > 0) keeps the rule simple and aligns with the
    // client's invariant that pickup/airport send `shipping_provider:
    // null`.
    expect(sql).toMatch(
      /IF p_shipping_provider IS NOT NULL AND p_selected_quote_id IS NULL THEN\s+RAISE EXCEPTION 'shipping_quote_required';/
    );
  });

  it('runs the shipping_quote_required check after param validation but before merchant lookup', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // Param validation (payment_status check) → shipping guard →
    // merchant existence check. Fail fast without touching merchants.
    const paymentStatusIndex = sql.indexOf(
      "RAISE EXCEPTION 'invalid_payment_status';"
    );
    const shippingGuardIndex = sql.indexOf(
      "RAISE EXCEPTION 'shipping_quote_required';"
    );
    const merchantLookupIndex = sql.search(
      /PERFORM\s+1\s+FROM\s+(?:public\.)?merchants\s+m\s+WHERE\s+m\.id\s*=\s*p_merchant_id/i
    );

    expect(paymentStatusIndex).toBeGreaterThan(-1);
    expect(shippingGuardIndex).toBeGreaterThan(paymentStatusIndex);
    expect(merchantLookupIndex).toBeGreaterThan(shippingGuardIndex);
  });
});

// B3.5 (Δ-42, Δ-47, Δ-50): the RPC is the VAT enforcement boundary
// because the storefront calls `create_storefront_order` via PostgREST
// anon. The plan explicitly says we cannot revoke anon access without
// breaking checkout, so the RPC must police itself. These contract
// tests guard against future regressions that would let a VAT-aware
// caller bypass the boundary.
describe('agentic storefront order RPC contract — B3.5 VAT enforcement', () => {
  it('adds p_tax_basis and p_gift_wrapping_fee params with safe defaults', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // Defaults preserve back-compat for callers that haven't been
    // updated yet (legacy /checkout) while VAT-aware callers
    // (ogabassey) pass both explicitly.
    expect(sql).toMatch(/p_tax_basis\s+TEXT\s+DEFAULT\s+'exclusive'/i);
    expect(sql).toMatch(/p_gift_wrapping_fee\s+NUMERIC\s+DEFAULT\s+0/i);
  });

  it('validates tax_basis enum membership and raises invalid_tax_basis', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // The default falls in the allowed set, but a typo'd caller
    // (e.g., 'EXCLUSIVE' before lowercase) must surface a stable
    // error code instead of a CHECK-constraint trap later.
    expect(sql).toMatch(
      /v_tax_basis\s+NOT\s+IN\s*\(\s*'exclusive'\s*,\s*'inclusive'\s*\)/i
    );
    expect(sql).toMatch(/RAISE EXCEPTION 'invalid_tax_basis'/i);
  });

  it('overrides v_tax_basis to "exclusive" after enum validation (Codex P1 round 6 ii)', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // The RPC is `GRANT ALL ... TO anon`, so PostgREST callers can
    // bypass /api/orders and route `p_tax_basis: 'inclusive'`
    // directly into the function. Without this override the
    // inclusive branch would compute `total = subtotal + shipping
    // + gift - discount` (no VAT) for VAT-registered merchants —
    // undercharge.
    //
    // Pin the override (a) exists, and (b) lands AFTER the enum
    // validation (so an obviously-bad caller still gets a clean
    // `invalid_tax_basis` instead of being silently normalized).
    expect(sql).toMatch(/v_tax_basis\s*:=\s*'exclusive'\s*;/);

    const enumValidationIndex = sql.indexOf(
      "RAISE EXCEPTION 'invalid_tax_basis'"
    );
    const overrideIndex = sql.search(/v_tax_basis\s*:=\s*'exclusive'\s*;/);
    expect(enumValidationIndex).toBeGreaterThan(-1);
    expect(overrideIndex).toBeGreaterThan(enumValidationIndex);

    // And the override MUST land BEFORE any branch that reads
    // `v_tax_basis` — both the VAT enforcement IF and the total
    // computation IF. Otherwise a caller could still slip through
    // before the override fires.
    const vatEnforcementIndex = sql.indexOf(
      "IF v_merchant_vat_status = 'registered' THEN"
    );
    const totalComputeIndex = sql.search(
      /IF\s+v_tax_basis\s*=\s*'exclusive'\s+THEN\s+v_total\s*:=/
    );
    expect(overrideIndex).toBeLessThan(vatEnforcementIndex);
    expect(overrideIndex).toBeLessThan(totalComputeIndex);
  });

  it('reads merchant VAT config once and uses the lookup result for tax enforcement', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // Single SELECT into both vat_status + vat_rate keeps the
    // enforcement decision atomic with the merchant's current
    // config. Pre-B3.5 the trigger looked up vat_status separately
    // and there was no atomicity between the RPC and trigger paths.
    expect(sql).toMatch(
      /SELECT[\s\S]*?m\.vat_registration_status[\s\S]*?m\.vat_rate[\s\S]*?INTO\s+v_merchant_vat_status,\s*v_merchant_vat_rate/i
    );
  });

  it('enforces tax_amount_mismatch for VAT-registered + exclusive merchants', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // Codex P1 round 3 + round 4 (PR #1622): expected_tax must
    // match the post-insert `populate_order_item_tax` +
    // `update_order_tax_totals` trigger pipeline byte-for-byte:
    //   * Per-line SUM with ROUND on each line (round 3 — uniform
    //     `subtotal * rate / 100` over-counted for mixed-category
    //     orders).
    //   * NULL fallbacks: vat_category_code → 'S', vat_rate → 7.5
    //     (round 4 — `populate_order_item_tax` only overrides NEW
    //     columns when the product fields are NOT NULL; otherwise
    //     the order_items COLUMN DEFAULTS take over).
    expect(sql).toMatch(
      /SELECT\s+COALESCE\(\s*SUM\([\s\S]*?CASE[\s\S]*?WHEN\s+COALESCE\(\s*p\.vat_category_code\s*,\s*'S'\s*\)\s*=\s*'S'[\s\S]*?ROUND\([\s\S]*?COALESCE\(\s*p\.vat_rate\s*,\s*7\.5\s*\)[\s\S]*?ELSE\s+0[\s\S]*?\)\s*,\s*0\s*\)[\s\S]*?INTO\s+v_expected_tax[\s\S]*?FROM\s+tmp_storefront_order_items\s+t\s+JOIN\s+(?:public\.)?products\s+p/i
    );
    expect(sql).toMatch(
      /ABS\(\s*v_tax_amount\s*-\s*v_expected_tax\s*\)\s*>\s*1/i
    );
    expect(sql).toMatch(/RAISE EXCEPTION 'tax_amount_mismatch'/i);

    // The old uniform formula must NOT come back — round-3 bug.
    expect(sql).not.toMatch(
      /v_expected_tax\s*:=\s*round\(\s*v_subtotal\s*\*\s*v_merchant_vat_rate\s*\/\s*100\s*,\s*2\s*\)/i
    );

    // The round-3 fallback to `v_merchant_vat_rate` must not come
    // back either — round-4 bug. The trigger inherits the
    // order_items column default 7.5, NOT the merchant's
    // configured vat_rate, so we must mirror that exactly.
    expect(sql).not.toMatch(
      /COALESCE\(\s*p\.vat_rate\s*,\s*v_merchant_vat_rate\s*\)/i
    );
  });

  it('rejects nonzero tax for non-VAT merchants regardless of basis', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // Non-registered merchants must charge no VAT — anything > 1
    // NGN (rounding) is fail-closed so a bug in
    // calculateCommerce can't accidentally collect non-existent
    // tax that nobody is required (or allowed) to remit.
    expect(sql).toMatch(
      /RAISE EXCEPTION 'tax_amount_must_be_zero_for_non_vat_merchant'/i
    );
  });

  it('recomputes total server-side per the matched basis (Δ-47)', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // Exclusive: subtotal + shipping + gift + tax - discount.
    // Inclusive: subtotal + shipping + gift - discount (tax already
    // inside subtotal). NO p_total / p_subtotal params accepted —
    // total is always derived from p_items.
    expect(sql).not.toMatch(/p_subtotal\s+NUMERIC/i);
    expect(sql).not.toMatch(/p_total\s+NUMERIC/i);

    // Both basis branches must be present in the body. The RPC has
    // TWO `IF v_tax_basis = 'exclusive' THEN` occurrences — the
    // first inside the VAT-enforcement guard (validation-only, no
    // v_total math) and the second inside the total-computation
    // block. Anchor on the second one by requiring `v_total :=` to
    // immediately follow, then walk to its ELSE branch (the
    // inclusive case).
    const totalComputeIndex = sql.search(
      /IF\s+v_tax_basis\s*=\s*'exclusive'\s+THEN\s+v_total\s*:=/
    );
    expect(totalComputeIndex).toBeGreaterThan(-1);
    const elseRelativeIndex = sql.slice(totalComputeIndex).search(/\bELSE\b/);
    expect(elseRelativeIndex).toBeGreaterThan(-1);
    const inclusiveStart = totalComputeIndex + elseRelativeIndex;
    const endIfRelativeIndex = sql.slice(inclusiveStart).search(/END IF;/);
    expect(endIfRelativeIndex).toBeGreaterThan(-1);
    const inclusiveBody = sql.slice(
      inclusiveStart,
      inclusiveStart + endIfRelativeIndex
    );

    // Inclusive body MUST sum subtotal + shipping + gift - discount,
    // and MUST NOT add v_tax_amount (tax is already inside subtotal
    // for inclusive merchants).
    expect(inclusiveBody).toMatch(
      /v_subtotal[\s\S]*?\+\s*v_shipping_fee[\s\S]*?\+\s*v_gift_wrapping_fee[\s\S]*?-\s*v_discount_amount/
    );
    expect(inclusiveBody).not.toMatch(/\+\s*v_tax_amount/);
  });

  it('persists tax_basis and gift_wrapping_fee atomically with the order row', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // Both new columns MUST land in the same INSERT INTO orders as
    // tax_amount / total. A two-statement insert+update would
    // re-open a partial-write window where trigger fires before
    // tax_basis is populated → trigger reads NULL → falls back to
    // pre-B3.5 behavior → total stays stale.
    const insertBlockMatch = sql.match(
      /INSERT\s+INTO\s+(?:public\.)?orders\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i
    );
    expect(insertBlockMatch).not.toBeNull();
    if (insertBlockMatch) {
      const columns = insertBlockMatch[1];
      expect(columns).toMatch(/tax_basis/);
      expect(columns).toMatch(/gift_wrapping_fee/);
      expect(columns).toMatch(/tax_amount/);
      expect(columns).toMatch(/\btotal\b/);
    }
  });

  // Codex P1 (PR #1622): the parity check MUST live inside the RPC,
  // BEFORE any side effects, so a mismatch rolls back the transaction
  // atomically. The pre-Codex API-level 409 fired AFTER the orders
  // INSERT and stock UPDATEs, leaving orphan unpaid orders and
  // reserved inventory on retry.
  it('runs the order_total_mismatch parity check BEFORE customer upsert and order insert (Codex P1)', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    expect(sql).toMatch(/p_expected_total\s+NUMERIC\s+DEFAULT\s+NULL/i);
    expect(sql).toMatch(/RAISE EXCEPTION 'order_total_mismatch'/);

    // The parity guard must come BEFORE the customer upsert advisory
    // locks AND the INSERT INTO orders. If those run first, RAISE
    // here would still rollback within the transaction, but only
    // because PostgreSQL's implicit transaction wraps the function
    // body — adding any client-side `BEGIN`/`COMMIT` framing around
    // the RPC would expose the gap. Placing the check above all
    // side effects keeps the guard local and obviously correct.
    const parityIndex = sql.indexOf("RAISE EXCEPTION 'order_total_mismatch'");
    const customerLockIndex = sql.indexOf(
      'hashtext(v_normalized_customer_phone)'
    );
    const orderInsertIndex = sql.search(/INSERT\s+INTO\s+(?:public\.)?orders/i);
    const stockUpdateIndex = sql.search(
      /UPDATE\s+(?:public\.)?product_variants/i
    );

    expect(parityIndex).toBeGreaterThan(-1);
    expect(parityIndex).toBeLessThan(customerLockIndex);
    expect(parityIndex).toBeLessThan(orderInsertIndex);
    expect(parityIndex).toBeLessThan(stockUpdateIndex);
  });

  // Codex P1 (PR #1622): the trigger now mutates `orders.total` for
  // exclusive orders. If the RPC returns the pre-trigger `v_total`,
  // the API uses a value that's already drifted from the persisted
  // row — payment ≠ row. Re-SELECT after the order_items insert
  // (which fires the trigger) keeps the returned tax_amount + total
  // consistent with the row.
  it('re-reads canonical total and tax_amount from the row before RETURN QUERY (Codex P1)', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql();

    // The re-SELECT must land AFTER the order_items INSERT (which
    // fires `update_order_tax_totals`) and BEFORE the RETURN QUERY.
    const itemsInsertIndex = sql.search(
      /INSERT\s+INTO\s+(?:public\.)?order_items/i
    );
    const reSelectMatch = sql.match(
      /SELECT\s+(?:[a-z]\.)?total,\s*(?:[a-z]\.)?tax_amount[\s\S]*?INTO\s+v_total,\s*v_tax_amount[\s\S]*?FROM\s+(?:public\.)?orders[\s\S]*?WHERE\s+(?:[a-z]\.)?id\s*=\s*v_order_id/i
    );
    const returnQueryIndex =
      reSelectMatch?.index === undefined
        ? -1
        : sql.indexOf('RETURN QUERY', reSelectMatch.index);

    expect(itemsInsertIndex).toBeGreaterThan(-1);
    expect(reSelectMatch).not.toBeNull();
    expect(returnQueryIndex).toBeGreaterThan(-1);

    if (reSelectMatch?.index !== undefined) {
      expect(reSelectMatch.index).toBeGreaterThan(itemsInsertIndex);
      expect(reSelectMatch.index).toBeLessThan(returnQueryIndex);
    }
  });

  it('drops the historical create_storefront_order signatures', () => {
    const sql = readLatestStorefrontOrderRpcMigrationSql({ unsliced: true });

    // Adding params changes the function identity in PostgreSQL —
    // `CREATE OR REPLACE` would leave the stale overloads alive,
    // and PostgREST positional callers could route to one that
    // skips the new enforcement. The migration MUST DROP every
    // prior signature explicitly: the 19-arg B3 form, the
    // intermediate 21-arg form from the initial B3.5 push, and the
    // 22-arg parity-check form after Codex P1 added `p_expected_total`.
    const dropMatches = sql.match(
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.create_storefront_order/gi
    );
    expect(dropMatches).not.toBeNull();
    expect(dropMatches?.length).toBeGreaterThanOrEqual(
      EXPECTED_CREATE_STOREFRONT_ORDER_DROP_COUNT
    );

    // The new signature must be re-granted to anon / authenticated
    // / service_role since DROP wipes function grants. The
    // `authenticated` grant matters as much as `anon` — mobile-admin
    // staff users on the dashboard order-create form go through
    // PostgREST with the authenticated role; missing this grant
    // would 403 their checkout.
    expect(sql).toMatch(
      /GRANT\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+public\.create_storefront_order[\s\S]*?\)\s*TO\s+[^;]*?\banon\b/i
    );
    expect(sql).toMatch(
      /GRANT\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+public\.create_storefront_order[\s\S]*?\)\s*TO\s+[^;]*?\bauthenticated\b/i
    );
    expect(sql).toMatch(
      /GRANT\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+public\.create_storefront_order[\s\S]*?\)\s*TO\s+[^;]*?\bservice_role\b/i
    );
  });

  it('preserves payload variant_name before deriving order item labels', () => {
    const sql = readFileSync(
      resolve(
        migrationsDirectory,
        '20260708213000_fix_create_storefront_order_variant_name.sql'
      ),
      'utf8'
    );

    expect(sql).toMatch(
      /NULLIF\s*\(\s*trim\s*\(\s*COALESCE\s*\(\s*item->>'variant_name'\s*,\s*item->>'variantName'\s*\)\s*\)\s*,\s*''\s*\)\s+AS\s+variant_name/i
    );

    const productVariantAttributesIndex = sql.indexOf(
      'public.format_order_item_variant_name(v.attributes)'
    );
    const payloadVariantNameIndex = sql.indexOf(
      "NULLIF(trim(r.variant_name), '')",
      productVariantAttributesIndex
    );
    const payloadVariantAttributesIndex = sql.indexOf(
      'public.format_order_item_variant_name(r.variant_attributes)',
      payloadVariantNameIndex
    );

    expect(productVariantAttributesIndex).toBeGreaterThan(-1);
    expect(payloadVariantNameIndex).toBeGreaterThan(
      productVariantAttributesIndex
    );
    expect(payloadVariantAttributesIndex).toBeGreaterThan(
      payloadVariantNameIndex
    );
    expect(sql).toContain('WHERE products.id = stock_rec.product_id');
    expect(sql).toContain('WHERE product_variants.id = v_variant_id');
  });
});

// B3.5 trigger contract: `update_order_tax_totals` MUST recompute
// `orders.total` for `tax_basis = 'exclusive'` orders so a line-item
// VAT update doesn't leave `tax_amount` and `total` inconsistent (the
// Δ-31 root-cause behavior). For `tax_basis = 'inclusive'` orders the
// trigger must leave `total` alone (tax is already inside subtotal).
describe('update_order_tax_totals trigger contract — B3.5', () => {
  function readLatestUpdateOrderTaxTotalsMigrationSql() {
    const triggerRpcDefinitionPattern =
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:"public"\.|public\.)?(?:"update_order_tax_totals"|update_order_tax_totals)\s*\(/i;
    for (const fileName of readdirSync(migrationsDirectory)
      .filter((file) => migrationFilePattern.test(file))
      .sort()
      .reverse()) {
      const sql = readFileSync(resolve(migrationsDirectory, fileName), 'utf8');
      if (triggerRpcDefinitionPattern.test(sql)) {
        return sql;
      }
    }
    throw new Error('No update_order_tax_totals migration found');
  }

  it('reads order tax_basis + total components alongside merchant VAT status', () => {
    const sql = readLatestUpdateOrderTaxTotalsMigrationSql();

    // Single SELECT joins merchants and orders so the trigger has
    // everything it needs to recompute total atomically — no
    // second round-trip that could see a different snapshot.
    expect(sql).toMatch(
      /SELECT[\s\S]*?m\.vat_registration_status[\s\S]*?o\.tax_basis[\s\S]*?o\.subtotal[\s\S]*?o\.shipping_fee[\s\S]*?o\.gift_wrapping_fee[\s\S]*?o\.discount_amount[\s\S]*?INTO/i
    );
  });

  it('recomputes total in the exclusive UPDATE alongside tax_amount + breakdown', () => {
    const sql = readLatestUpdateOrderTaxTotalsMigrationSql();

    // Locate the trigger's exclusive branch.
    const exclusiveIndex = sql.indexOf("IF order_tax_basis = 'exclusive' THEN");
    expect(exclusiveIndex).toBeGreaterThan(-1);

    const elseIndex = sql.indexOf('ELSE', exclusiveIndex);
    const exclusiveBlock = sql.slice(exclusiveIndex, elseIndex);

    expect(exclusiveBlock).toMatch(/UPDATE orders/i);
    expect(exclusiveBlock).toMatch(/tax_amount\s*=\s*new_tax_amount/i);
    // Total recomputation MUST be inside the exclusive UPDATE
    // statement, not a follow-up that could race. Allow the
    // `GREATEST(0, …)` clamp (Codex P1 PR #1622) so a discount
    // larger than the order doesn't write a negative total.
    expect(exclusiveBlock).toMatch(
      /total\s*=\s*GREATEST\(\s*0\s*,\s*order_subtotal\s*\+\s*order_shipping_fee\s*\+\s*order_gift_wrapping_fee\s*\+\s*new_tax_amount\s*-\s*order_discount_amount\s*\)/i
    );
  });

  it('leaves total invariant for inclusive (and NULL) tax_basis orders', () => {
    const sql = readLatestUpdateOrderTaxTotalsMigrationSql();

    // The ELSE branch (which catches both 'inclusive' AND NULL
    // tax_basis pre-backfill) must ONLY update breakdown columns —
    // changing total here would silently rewrite historical
    // inclusive orders the A0 backfill is still classifying.
    const exclusiveIndex = sql.indexOf("IF order_tax_basis = 'exclusive' THEN");
    const elseIndex = sql.indexOf('ELSE', exclusiveIndex);
    const endIfIndex = sql.indexOf('END IF;', elseIndex);
    const elseBlock = sql.slice(elseIndex, endIfIndex);

    expect(elseBlock).toMatch(/UPDATE orders/i);
    expect(elseBlock).toMatch(/tax_amount\s*=\s*new_tax_amount/i);
    expect(elseBlock).not.toMatch(/\btotal\s*=/i);
  });

  it('clears stale order_tax_subtotals before rebuilding (CodeRabbit round 7)', () => {
    const sql = readLatestUpdateOrderTaxTotalsMigrationSql();

    // Pre-fix the trigger only upserted (order_id, vat_category,
    // vat_rate) rows that still existed — orphans from deleted
    // order_items / category changes / unregistration drifted out
    // of sync with the canonical `order_items` view. The fix
    // clears the slice for this order before rebuilding, atomic
    // within the trigger transaction.
    const deleteMatch = sql.match(
      /DELETE\s+FROM\s+order_tax_subtotals\s+WHERE\s+order_id\s*=\s*order_uuid\s*;/i
    );
    expect(deleteMatch).not.toBeNull();

    // The DELETE must precede the INSERT into the same table so
    // the rebuild lands on a clean slice (otherwise the DELETE
    // would wipe what we just inserted).
    const deleteIndex =
      deleteMatch && deleteMatch.index !== undefined ? deleteMatch.index : -1;
    const insertIndex = sql.search(/INSERT\s+INTO\s+order_tax_subtotals/i);
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeLessThan(insertIndex);

    // The DELETE must also live OUTSIDE the
    // `IF merchant_vat_status = 'registered' THEN` block so a
    // merchant flipping from registered to not-registered clears
    // their prior subtotals too.
    const registeredBlockIndex = sql.indexOf(
      "IF merchant_vat_status = 'registered' THEN"
    );
    expect(registeredBlockIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeLessThan(registeredBlockIndex);
  });
});
