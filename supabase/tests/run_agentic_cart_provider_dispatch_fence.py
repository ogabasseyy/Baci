#!/usr/bin/env python3
"""Run the cart suite and provider-dispatch fence contracts in disposable PostgreSQL."""
from pathlib import Path

root = Path(__file__).resolve().parents[2]
base_runner = root / 'supabase/tests/run_commerce_cart_remaining_review.py'
source = base_runner.read_text()
source = source.replace('CREATE FUNCTION auth.uid()', 'CREATE OR REPLACE FUNCTION auth.uid()')
source = source.replace(
    "ALTER TABLE public.merchants ADD COLUMN payout_currency text DEFAULT 'NGN', ADD COLUMN country text,ADD COLUMN is_published boolean DEFAULT true,ADD COLUMN is_platform_admin boolean DEFAULT false;",
    "ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS payout_currency text DEFAULT 'NGN', ADD COLUMN IF NOT EXISTS country text, ADD COLUMN IF NOT EXISTS is_published boolean DEFAULT true, ADD COLUMN IF NOT EXISTS is_platform_admin boolean DEFAULT false;",
)
setup_anchor = "CREATE TABLE public.checkout_sessions(id uuid,session_id text,merchant_id uuid,metadata jsonb)"
if source.count(setup_anchor) != 1:
    raise SystemExit('checkout_sessions fixture anchor changed; refusing to run stale harness')
source = source.replace(
    setup_anchor,
    "CREATE TABLE public.checkout_sessions(id uuid,session_id text,merchant_id uuid,status text DEFAULT 'processing',metadata jsonb,payment_reference text,order_id uuid,virtual_account_number text)",
    1,
)
test_anchor = " tests=(root/'supabase/tests/commerce_cart_remaining_review.sql').read_text()"
if source.count(test_anchor) != 1:
    raise SystemExit('cart test anchor changed; refusing to run stale harness')
source = source.replace(
    test_anchor,
    " sql+='\\n'+(root/'supabase/migrations/20261015161000_commerce_cart_retirement_retention.sql').read_text()\n sql+='\\n'+(root/'supabase/migrations/20261106190000_agentic_shared_cart_provider_dispatch_fence.sql').read_text()\n sql+='\\n'+(root/'supabase/migrations/20261106191000_agentic_shared_cart_dispatch_cleanup_fence.sql').read_text()\n sql+='\\n'+(root/'supabase/migrations/20261106192000_agentic_shared_cart_retention_fences.sql').read_text()\n sql+='\\n'+(root/'supabase/migrations/20261106193000_agentic_cart_dispatch_revocation_safety.sql').read_text()\n sql+='\\n'+(root/'supabase/migrations/20261106230000_agentic_cart_dispatch_admission_off.sql').read_text()\n tests=''",
    1,
)
append_anchor = " sql+='\\n'+tests"
if source.count(append_anchor) != 1:
    raise SystemExit('cart test append anchor changed; refusing to run stale harness')
source = source.replace(
    append_anchor,
    " fence_sql=(root/'supabase/tests/agentic_cart_provider_dispatch_fence.sql').read_text()+'\\n'+(root/'supabase/tests/agentic_cart_provider_dispatch_cleanup.sql').read_text()+'\\n'+(root/'supabase/tests/agentic_cart_provider_dispatch_revocation_race.sql').read_text()\n fence_sql=fence_sql.replace('__PG_CONN__',f\"host={p/'sock'} port=55489 user=postgres dbname=postgres\")\n" + append_anchor + "\n sql+='\\n'+fence_sql",
    1,
)
exec(compile(source, str(base_runner), 'exec'), {'__file__': str(base_runner), '__name__': '__main__'})
