#!/usr/bin/env python3
"""Apply real shipping schema migrations and exercise revision row mutexes."""
import atexit
import json
import pathlib
import re
import shutil
import socket
import subprocess
import tempfile
from shipping_revision_concurrency import (
    verify_deadlock_fails_closed,
    verify_migration_seed_race,
    verify_projection_locking,
)

ROOT = pathlib.Path(__file__).resolve().parents[2]
BIN = pathlib.Path(subprocess.check_output(["pg_config", "--bindir"], text=True).strip())
TMP = pathlib.Path(tempfile.mkdtemp(prefix="sr-", dir="/tmp"))
SOCK = TMP / "sock"
SOCK.mkdir()
DATA = TMP / "data"
LOG = TMP / "postgres.log"


def cleanup():
    if (DATA / "postmaster.pid").exists():
        subprocess.run(
            [str(BIN / "pg_ctl"), "-D", str(DATA), "stop", "-m", "immediate"],
            text=True,
            capture_output=True,
            check=False,
            timeout=10,
        )
    shutil.rmtree(TMP, ignore_errors=True)


atexit.register(cleanup)


def run(args, *, sql=None, check=True, env=None):
    return subprocess.run(
        [str(BIN / args[0]), *args[1:]],
        input=sql,
        text=True,
        capture_output=True,
        check=check,
        env=env,
    )


def psql_quote(path):
    quoted_path = str(path).replace("\\", "\\\\").replace("'", "''")
    return f"'{quoted_path}'"


def psql_include(path):
    return f"\\i {psql_quote(path)}"


run(["initdb", "-D", str(DATA), "-U", "postgres", "--auth=trust", "--no-locale"])
with socket.socket() as port_reservation:
    port_reservation.bind(("127.0.0.1", 0))
    PGPORT = port_reservation.getsockname()[1]
run(["pg_ctl", "-D", str(DATA), "-l", str(LOG), "-o", f"-h '' -k {SOCK} -p {PGPORT}", "start"])
PSQL = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", str(SOCK), "-p", str(PGPORT), "-U", "postgres", "-d", "postgres"]

setup = r"""
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.check_staff_permission(uuid, uuid, text, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TABLE public.merchants (id uuid PRIMARY KEY, slug text NOT NULL, premium_features jsonb NOT NULL DEFAULT '[]', payout_currency text DEFAULT 'NGN', country text);
\i __MIGRATION_120001__
\i __MIGRATION_120003__
\i __MIGRATION_120005__
CREATE TABLE public.merchant_feature_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL UNIQUE REFERENCES public.merchants(id) ON DELETE CASCADE, shipping_providers jsonb NOT NULL DEFAULT '[]');
__SUPPORTED_CARRIER_FUNCTION__
__STOREFRONT_RATES_FUNCTION__
INSERT INTO public.merchants(id,slug) VALUES
 ('10000000-0000-4000-8000-000000000001','merchant-one'),
 ('10000000-0000-4000-8000-000000000002','merchant-two');
INSERT INTO public.merchant_feature_settings(merchant_id) VALUES
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.merchant_shipping_zones(id,merchant_id,name) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','one'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','two');
INSERT INTO public.merchant_shipping_zone_locations(zone_id,country_code,subdivision_code) VALUES
 ('20000000-0000-4000-8000-000000000001','NG','NG-LA');
INSERT INTO public.merchant_shipping_rates(id,merchant_id,zone_id,name,currency,base_amount) VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','r1','NGN',10),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','r2','NGN',20),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','r3','NGN',30),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','r4','NGN',40),
 ('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','r5','NGN',50);
"""
for key, filename in {
    "__MIGRATION_120001__": "20260713120001_merchant_shipping_zones_and_rates.sql",
    "__MIGRATION_120003__": "20260713120003_shipping_rate_zone_same_merchant.sql",
    "__MIGRATION_120005__": "20260713120005_enforce_shipping_zone_location_no_overlap.sql",
}.items():
    setup = setup.replace(key, psql_quote(ROOT / "supabase/migrations" / filename))
provider_migration = (ROOT / "supabase/migrations/20260926130000_repair_shipping_provider_policy_audit.sql").read_text()
carrier_function = re.search(
    r"CREATE OR REPLACE FUNCTION private\.supported_carrier_provider_ids\(\)[\s\S]*?\$\$;",
    provider_migration,
).group()
setup = setup.replace("__SUPPORTED_CARRIER_FUNCTION__", carrier_function)
storefront_rates_function = re.search(
    r"CREATE OR REPLACE FUNCTION public\.get_storefront_shipping_rates\(\s*p_merchant_id uuid\s*\)[\s\S]*?\$\$;",
    provider_migration,
).group()
setup = setup.replace("__STOREFRONT_RATES_FUNCTION__", storefront_rates_function)
run(PSQL, sql=setup)


def scalar(sql):
    return run(PSQL + ["-At", "-c", sql]).stdout.strip()


def revision(merchant):
    return int(scalar(f"SELECT revision FROM public.merchant_shipping_config_revisions WHERE merchant_id='{merchant}'"))


m1 = "10000000-0000-4000-8000-000000000001"
m2 = "10000000-0000-4000-8000-000000000002"
m3 = "10000000-0000-4000-8000-000000000003"
z1 = "20000000-0000-4000-8000-000000000001"
z2 = "20000000-0000-4000-8000-000000000002"
r1 = "30000000-0000-4000-8000-000000000001"
r2 = "30000000-0000-4000-8000-000000000002"
r3 = "30000000-0000-4000-8000-000000000003"
r4 = "30000000-0000-4000-8000-000000000004"
r5 = "30000000-0000-4000-8000-000000000005"

# Compare the draft RPC's complete legacy projection against the current
# production function on the same seeded rows. The only allowed delta is the
# newly-added revision field.
baseline_m1 = json.loads(scalar(f"SELECT public.get_storefront_shipping_rates('{m1}')::text"))
baseline_m2 = json.loads(scalar(f"SELECT public.get_storefront_shipping_rates('{m2}')::text"))
verify_migration_seed_race(ROOT, PSQL, scalar, revision)
# Exercise location mutations while the original revision trigger is installed.
# The preceding shipping migration stamps merchant_id from the parent zone, so
# the original trigger must advance the old and new merchant revisions.
before_one, before_two = revision(m1), revision(m2)
run(PSQL + ["-c", f"INSERT INTO public.merchant_shipping_zone_locations(zone_id,country_code,subdivision_code) VALUES ('{z1}','GH','GH-AA')"])
assert revision(m1) > before_one, "original location trigger did not advance the revision on insert"
before_one = revision(m1)
run(PSQL + ["-c", f"DELETE FROM public.merchant_shipping_zone_locations WHERE zone_id='{z1}' AND country_code='GH'"])
assert revision(m1) > before_one, "original location trigger did not advance the revision on delete"
before_one, before_two = revision(m1), revision(m2)
run(PSQL + ["-c", f"UPDATE public.merchant_shipping_zone_locations SET zone_id='{z2}' WHERE zone_id='{z1}' AND country_code='NG'"])
assert revision(m1) > before_one and revision(m2) > before_two, "original location trigger did not advance both reassigned merchant revisions"
before_one, before_two = revision(m1), revision(m2)
run(PSQL + ["-c", f"UPDATE public.merchant_shipping_zone_locations SET zone_id='{z1}' WHERE zone_id='{z2}' AND country_code='NG'"])
assert revision(m1) > before_one and revision(m2) > before_two, "restoring the location did not advance both merchant revisions"
assert scalar(f"SELECT count(*) FROM public.merchant_shipping_zone_locations WHERE zone_id='{z1}' AND country_code='NG'") == "1", "pre-fix location setup was not restored"
# Apply the append-only correction after exercising the original migration's
# concurrent seed/backfill behavior.
location_revision_fix = ROOT / "supabase/migrations/20261106160000_fix_shipping_location_revision_trigger.sql"
run(PSQL, sql=f"{psql_include(location_revision_fix)}\n")
tenant_integrity_fix = ROOT / "supabase/migrations/20261106170000_harden_shipping_revision_tenant_integrity.sql"
run(PSQL, sql=f"{psql_include(tenant_integrity_fix)}\n")
revision_access_policy = ROOT / "supabase/migrations/20261106180000_deny_direct_shipping_revision_access.sql"
run(PSQL, sql=f"{psql_include(revision_access_policy)}\n")
# These two forward migrations can be applied again individually without
# changing the intended FK or the single deny-all policy.
run(PSQL, sql=f"{psql_include(tenant_integrity_fix)}\n")
run(PSQL, sql=f"{psql_include(revision_access_policy)}\n")
wrong_fk_replay = f"""
BEGIN;
ALTER TABLE public.merchant_shipping_config_revisions
  DROP CONSTRAINT merchant_shipping_config_revisions_merchant_id_fkey;
ALTER TABLE public.merchant_shipping_config_revisions
  ADD CONSTRAINT merchant_shipping_config_revisions_merchant_id_fkey
  FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT;
{psql_include(tenant_integrity_fix)}
ROLLBACK;
"""
wrong_fk_result = run(PSQL, sql=wrong_fk_replay, check=False)
assert wrong_fk_result.returncode != 0 and "already exists" in wrong_fk_result.stderr.lower(), "tenant-integrity replay must fail closed for a same-name FK with a different delete action"
assert scalar("SELECT confdeltype FROM pg_constraint WHERE conrelid='public.merchant_shipping_config_revisions'::regclass AND conname='merchant_shipping_config_revisions_merchant_id_fkey'") == "c", "wrong-FK replay fixture did not roll back to ON DELETE CASCADE"
access_boundary_comment = ROOT / "supabase/migrations/20261106200000_document_shipping_revision_access_boundary.sql"
run(PSQL, sql=f"{psql_include(access_boundary_comment)}\n")
for merchant, baseline in [(m1, baseline_m1), (m2, baseline_m2)]:
    revised = json.loads(scalar(f"SELECT public.get_storefront_shipping_rates('{merchant}')::text"))
    assert revised.pop("shipping_config_revision", None) is not None, "new projection omitted its revision"
    assert revised == baseline, f"projection changed an existing shopper-safe field for {merchant}"

# Existing merchant, basic row mutations, reassignment, and currency changes.
for sql, merchant in [
    (f"INSERT INTO public.merchant_shipping_rates(merchant_id,zone_id,name,currency,base_amount) VALUES ('{m1}','{z1}','phantom','NGN',5)", m1),
    (f"INSERT INTO public.merchant_shipping_zone_locations(zone_id,country_code,subdivision_code) VALUES ('{z1}','GH','GH-AA')", m1),
    (f"UPDATE public.merchant_shipping_rates SET base_amount=11 WHERE id='{r1}'", m1),
    (f"DELETE FROM public.merchant_shipping_zone_locations WHERE zone_id='{z1}' AND country_code='GH'", m1),
    (f"UPDATE public.merchants SET country='GH', payout_currency='GHS' WHERE id='{m1}'", m1),
    (f"UPDATE public.merchant_feature_settings SET shipping_providers='[\" GIGL \",\"Shiip\",\"topship\",\"gigl\",\"UNKNOWN\"]' WHERE merchant_id='{m1}'", m1),
]:
    before = revision(merchant)
    run(PSQL + ["-c", sql])
    assert revision(merchant) > before, f"config mutation did not advance {merchant}: {sql}"

# A location reassignment resolves both merchants through its old and new zones.
before_one, before_two = revision(m1), revision(m2)
run(PSQL + ["-c", f"UPDATE public.merchant_shipping_zone_locations SET zone_id='{z2}' WHERE zone_id='{z1}' AND country_code='NG'"])
assert revision(m1) > before_one and revision(m2) > before_two, "location reassignment did not advance both merchant revisions"

before_one, before_two = revision(m1), revision(m2)
run(PSQL + ["-c", f"UPDATE public.merchant_shipping_rates SET merchant_id='{m2}',zone_id='{z2}' WHERE id='{r1}'"])
assert revision(m1) > before_one and revision(m2) > before_two, "reassignment did not advance both merchant revisions"

# New merchant seed plus first mutation must not reuse the initial revision.
run(PSQL + ["-c", f"INSERT INTO public.merchants(id,slug) VALUES ('{m3}','merchant-three')"])
assert revision(m3) == 1, "new merchant did not receive initial revision"
z3 = "20000000-0000-4000-8000-000000000003"
run(PSQL + ["-c", f"INSERT INTO public.merchant_shipping_zones(id,merchant_id,name) VALUES ('{z3}','{m3}','three')"])
assert revision(m3) == 2, "first config mutation did not advance new merchant revision"
run(PSQL + ["-c", f"INSERT INTO public.merchant_feature_settings(merchant_id) VALUES ('{m3}')"])
run(PSQL + ["-c", f"DELETE FROM public.merchant_feature_settings WHERE merchant_id='{m2}'"])
before_two, before_three = revision(m2), revision(m3)
run(PSQL + ["-c", f"UPDATE public.merchant_feature_settings SET merchant_id='{m2}' WHERE merchant_id='{m3}'"])
assert revision(m2) > before_two and revision(m3) > before_three, "feature settings reassignment did not advance both merchant revisions"

# A config rollback must roll its revision write back as well.
before = revision(m2)
price_before = scalar(f"SELECT base_amount FROM public.merchant_shipping_rates WHERE id='{r1}'")
run(PSQL + ["-c", f"BEGIN; UPDATE public.merchant_shipping_rates SET base_amount=99 WHERE id='{r1}'; ROLLBACK"])
assert revision(m2) == before and scalar(f"SELECT base_amount FROM public.merchant_shipping_rates WHERE id='{r1}'") == price_before, "rollback left config/revision mismatch"

# One statement touching two merchants advances both revisions.
before_one, before_two = revision(m1), revision(m2)
run(PSQL + ["-c", f"UPDATE public.merchant_shipping_rates SET base_amount=base_amount+1 WHERE id IN ('{r1}','{r3}')"])
assert revision(m1) > before_one and revision(m2) > before_two, "multi-tenant statement failed to bump all revisions"

projection = scalar(f"SELECT public.get_storefront_shipping_rates('{m2}') ->> 'shipping_config_revision'")
assert projection == str(revision(m2)), "projection revision mismatch"
providers = scalar(f"SELECT public.get_storefront_shipping_rates('{m1}') -> 'shipping_providers'")
assert providers == '["gigl", "topship"]', f"provider projection lost production normalization/allowlist behavior: {providers}"
assert scalar("SELECT provolatile FROM pg_proc WHERE oid='public.get_storefront_shipping_rates(uuid)'::regprocedure") == "v", "projection must be VOLATILE for post-wait rereads"

verify_projection_locking(BIN, PSQL, scalar, revision, run, r1, r3, m1, m2)
verify_deadlock_fails_closed(BIN, PSQL, scalar, r2, r3, r4, r5)

# Cascaded zone deletion bumps its merchant; merchant deletion removes revision
# state and child cascades cannot recreate it.
before = revision(m2)
run(PSQL + ["-c", f"DELETE FROM public.merchant_shipping_zones WHERE id='{z2}'"])
assert revision(m2) > before, "zone/rate cascade did not advance merchant revision"
run(PSQL + ["-c", f"DELETE FROM public.merchants WHERE id='{m1}'"])
assert scalar(f"SELECT count(*) FROM public.merchant_shipping_config_revisions WHERE merchant_id='{m1}'") == "0", "merchant deletion left/recreated revision"

# The private revision is protected from all API roles.
assert scalar("SELECT relrowsecurity FROM pg_class WHERE oid='public.merchant_shipping_config_revisions'::regclass") == "t", "revision table RLS is disabled"
assert scalar("SELECT count(*) FROM pg_policy WHERE polrelid='public.merchant_shipping_config_revisions'::regclass AND polname='merchant_shipping_config_revisions_deny_direct_access' AND pg_get_expr(polqual, polrelid)='false' AND pg_get_expr(polwithcheck, polrelid)='false'") == "1", "revision table is missing its deny-all RLS policy"
assert scalar("SELECT count(*) FROM pg_policy WHERE polrelid='public.merchant_shipping_config_revisions'::regclass") == "1", "revision table must have exactly one deny-all RLS policy"
assert scalar("SELECT description FROM pg_description d JOIN pg_policy p ON d.objoid=p.oid AND d.classoid='pg_policy'::regclass WHERE p.polrelid='public.merchant_shipping_config_revisions'::regclass AND p.polname='merchant_shipping_config_revisions_deny_direct_access'") == "This RLS policy denies direct access for roles subject to row-level security. service_role bypasses RLS; its direct access is blocked by the table ACL revocation. Use narrowly scoped SECURITY DEFINER functions.", "policy comment must distinguish RLS from service_role ACL enforcement"
assert scalar("SELECT confdeltype FROM pg_constraint WHERE conrelid='public.merchant_shipping_config_revisions'::regclass AND conname='merchant_shipping_config_revisions_merchant_id_fkey'") == "c", "revision rows must cascade with their merchant"
for role in ["anon", "authenticated", "service_role"]:
    for privilege in ["SELECT", "INSERT", "UPDATE", "DELETE"]:
        assert scalar(f"SELECT has_table_privilege('{role}','public.merchant_shipping_config_revisions','{privilege}')") == "f", f"{role} has {privilege} on internal revisions"

print("merchant shipping config revision mutex, rollback, cascade and concurrency checks passed")
