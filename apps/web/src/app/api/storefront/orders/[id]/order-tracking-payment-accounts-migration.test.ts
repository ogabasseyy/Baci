import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../../supabase/migrations'
);

it('adds payment_accounts while preserving tracking authorization and response logic', () => {
  const original = readFileSync(
    resolve(
      migrationsDir,
      '20260921130000_include_tracking_order_amount_paid.sql'
    ),
    'utf8'
  );
  const migration = readFileSync(
    resolve(
      migrationsDir,
      '20260921180100_include_tracking_order_payment_accounts.sql'
    ),
    'utf8'
  );
  const unchanged = migration
    .replace(
      'BEGIN;\n\n-- Guest Pay for Me success pages need the provisioned virtual account to\n-- render copyable payer instructions (the proof-bound guest branch never\n-- loads payment accounts, so the lookup must carry them).\nDROP FUNCTION IF EXISTS public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT);\n\n',
      'BEGIN;\n\n-- Guest success pages need the persisted credited amount to reconcile payer\n-- instructions with orders.total (partial wallet/savings coverage).\nDROP FUNCTION IF EXISTS public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT);\n\n'
    )
    .replace('  items JSONB,\n  payment_accounts JSONB\n', '  items JSONB\n')
    .replace(
      "    ) AS items,\n    COALESCE(\n      (\n        SELECT jsonb_agg(\n          jsonb_build_object(\n            'account_number', opa.account_number,\n            'bank_name', opa.bank_name,\n            'account_name', opa.account_name,\n            'provider', opa.provider,\n            'assignment_customer_email_source', opa.assignment_customer_email_source,\n            'created_at', opa.created_at,\n            'assigned_at', opa.assigned_at,\n            'expires_at', opa.expires_at\n          )\n          ORDER BY opa.created_at DESC NULLS LAST, opa.account_number\n        )\n        FROM order_payment_accounts opa\n        WHERE opa.order_id = o.id\n      ),\n      '[]'::jsonb\n    ) AS payment_accounts\n",
      '    ) AS items\n'
    );
  expect(unchanged).toBe(original);
  expect(migration).toContain('  payment_accounts JSONB');
  expect(migration).toContain('FROM order_payment_accounts opa');
  expect(migration).toContain('WHERE opa.order_id = o.id');
  expect(migration).toContain(
    'DROP FUNCTION IF EXISTS public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT);'
  );
});
