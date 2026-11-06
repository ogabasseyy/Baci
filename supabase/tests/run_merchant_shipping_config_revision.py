#!/usr/bin/env python3
"""Apply real shipping schema migrations and exercise revision row mutexes."""
import atexit
import os
import json
import pathlib
import re
import shutil
import socket
import subprocess
import tempfile
import time

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
    setup = setup.replace(key, str(ROOT / "supabase/migrations" / filename))
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
migration_path = ROOT / "supabase/migrations/20261106150000_merchant_shipping_config_revision.sql"
migration_sql = migration_path.read_text()
assert migration_sql.index("CREATE TRIGGER initialize_merchant_shipping_config_revision") < migration_sql.index(
    "INSERT INTO public.merchant_shipping_config_revisions (merchant_id, revision)\nSELECT id, 1 FROM public.merchants"
), "merchant initialization trigger must precede revision backfill"

# Keep a merchant insert open while migration DDL installs the seed trigger.
# CREATE TRIGGER must wait for that writer; the following backfill then sees
# its committed row, closing the backfill/trigger installation race.
race_merchant = "10000000-0000-4000-8000-000000000099"
writer = subprocess.Popen(
    PSQL + ["-c", f"SET application_name='shipping_revision_race_writer'; INSERT INTO public.merchants(id,slug) VALUES ('{race_merchant}','merchant-race'); SELECT pg_sleep(1.5)"],
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
writer_ready = False
writer_deadline = time.monotonic() + 5
while time.monotonic() < writer_deadline:
    if scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='shipping_revision_race_writer' AND state='active'") == "1":
        writer_ready = True
        break
    time.sleep(0.05)
assert writer_ready, "concurrent merchant insert did not start"

migration = subprocess.Popen(
    PSQL + ["-c", f"\\i {migration_path}"],
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
trigger_waited = False
migration_deadline = time.monotonic() + 8
while time.monotonic() < migration_deadline:
    if scalar("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%CREATE TRIGGER initialize_merchant_shipping_config_revision%'") == "1":
        trigger_waited = True
        break
    if migration.poll() is not None:
        break
    time.sleep(0.05)
assert trigger_waited, "migration did not wait for the in-flight merchant insert at trigger installation"
writer_out, writer_err = writer.communicate(timeout=8)
assert writer.returncode == 0, f"concurrent merchant insert failed: {writer_err or writer_out}"
migration_out, migration_err = migration.communicate(timeout=10)
assert migration.returncode == 0, f"migration failed: {migration_err or migration_out}"
assert revision(race_merchant) == 1, "merchant committed during trigger installation was missed by backfill"
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

before_one, before_two = revision(m1), revision(m2)
run(PSQL + ["-c", f"UPDATE public.merchant_shipping_rates SET merchant_id='{m2}',zone_id='{z2}' WHERE id='{r1}'"])
assert revision(m1) > before_one and revision(m2) > before_two, "reassignment did not advance both merchant revisions"

# New merchant seed plus first mutation must not reuse the initial revision.
run(PSQL + ["-c", f"INSERT INTO public.merchants(id,slug) VALUES ('{m3}','merchant-three')"])
assert revision(m3) == 1, "new merchant did not receive initial revision"
z3 = "20000000-0000-4000-8000-000000000003"
run(PSQL + ["-c", f"INSERT INTO public.merchant_shipping_zones(id,merchant_id,name) VALUES ('{z3}','{m3}','three')"])
assert revision(m3) == 2, "first config mutation did not advance new merchant revision"

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

# Hold m2's revision row through a config update. The quote RPC must wait, then
# return the committed revision and amount; m1 remains independently writable.
reader_sql = f"BEGIN; SELECT public.get_storefront_shipping_rates('{m2}'); SELECT pg_sleep(1.2); COMMIT"
reader = subprocess.Popen(
    [str(BIN / "psql"), *PSQL[1:], "-c", reader_sql], text=True,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    env={**os.environ, "PGAPPNAME": "shipping_reader_m2"},
)
deadline = time.monotonic() + 5
active_reader = "0"
while time.monotonic() < deadline:
    active_reader = scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='shipping_reader_m2' AND wait_event='PgSleep'")
    if active_reader == "1":
        break
    time.sleep(0.03)
assert active_reader == "1", "reader did not retain its shared revision lock"
start = time.monotonic()
scalar(f"SELECT public.get_storefront_shipping_rates('{m2}') ->> 'shipping_config_revision'")
concurrent_reader_elapsed = time.monotonic() - start
assert concurrent_reader_elapsed < 0.7, f"same-merchant quote readers serialized ({concurrent_reader_elapsed:.2f}s)"
start = time.monotonic()
run(PSQL + ["-c", f"UPDATE public.merchant_shipping_rates SET base_amount=13 WHERE id='{r1}'"])
writer_waited_for_reader = time.monotonic() - start
reader.communicate(timeout=10)
assert reader.returncode == 0 and writer_waited_for_reader >= 0.7, "config writer did not wait for active quote snapshot"

writer_sql = f"BEGIN; UPDATE public.merchant_shipping_rates SET base_amount=12 WHERE id='{r1}'; SELECT pg_sleep(1.4); COMMIT"
writer = subprocess.Popen(
    [str(BIN / "psql"), *PSQL[1:], "-c", writer_sql], text=True,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    env={**os.environ, "PGAPPNAME": "shipping_writer_m2"},
)
deadline = time.monotonic() + 5
active = "0"
while time.monotonic() < deadline:
    active = scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='shipping_writer_m2' AND wait_event='PgSleep'")
    if active == "1":
        break
    time.sleep(0.03)
assert active == "1", "writer did not reach its held-revision interval"

start = time.monotonic()
run(PSQL + ["-c", f"UPDATE public.merchant_shipping_rates SET base_amount=4 WHERE id='{r3}'"])
unrelated_elapsed = time.monotonic() - start
assert unrelated_elapsed < 0.7, f"merchant m1 write waited on merchant m2 revision ({unrelated_elapsed:.2f}s)"

quote_sql = f"SELECT (payload->>'shipping_config_revision') || ':' || (SELECT rate->>'base_amount' FROM jsonb_array_elements(payload->'rates') AS rate WHERE rate->>'id'='{r1}') FROM (SELECT public.get_storefront_shipping_rates('{m2}') AS payload) AS quote"
start = time.monotonic()
quote = scalar(quote_sql)
quote_elapsed = time.monotonic() - start
writer.communicate(timeout=10)
assert writer.returncode == 0, "config writer failed"
assert quote_elapsed >= 0.7, f"same-merchant projection did not wait for writer commit ({quote_elapsed:.2f}s)"
quote_revision, quote_amount = quote.split(":")
assert int(quote_revision) == revision(m2) and quote_amount == "12.00", f"projection mixed config and revision: {quote}"

# Reordered multi-statement transactions can still deadlock when they acquire
# merchant revision rows in opposite orders. PostgreSQL must abort one complete
# transaction (40P01); neither partial config writes nor hidden replay occur.
deadlock_a_sql = f"BEGIN; UPDATE public.merchant_shipping_rates SET base_amount=31 WHERE id='{r3}'; SELECT pg_sleep(0.45); UPDATE public.merchant_shipping_rates SET base_amount=41 WHERE id='{r4}'; COMMIT"
deadlock_b_sql = f"BEGIN; UPDATE public.merchant_shipping_rates SET base_amount=22 WHERE id='{r2}'; SELECT pg_sleep(0.45); UPDATE public.merchant_shipping_rates SET base_amount=51 WHERE id='{r5}'; COMMIT"
verbose_psql = [str(BIN / "psql"), *PSQL[1:3], "-v", "VERBOSITY=verbose", *PSQL[3:]]
deadlock_a = subprocess.Popen(
    verbose_psql + ["-c", deadlock_a_sql], text=True,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    env={**os.environ, "PGAPPNAME": "shipping_multi_tx_a"},
)
time.sleep(0.12)
deadlock_b = subprocess.Popen(
    verbose_psql + ["-c", deadlock_b_sql], text=True,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    env={**os.environ, "PGAPPNAME": "shipping_multi_tx_b"},
)
deadlock_a_out = deadlock_a.communicate(timeout=10)
deadlock_b_out = deadlock_b.communicate(timeout=10)
assert "40P01" in deadlock_a_out[1] or "40P01" in deadlock_b_out[1], "opposite-order merchant mutex contention did not fail closed with 40P01"
assert (deadlock_a.returncode == 0) != (deadlock_b.returncode == 0), "expected exactly one multi-tenant transaction to abort"
values = scalar(f"SELECT string_agg(id::text||'='||base_amount::text,',' ORDER BY id) FROM public.merchant_shipping_rates WHERE id IN ('{r2}','{r3}','{r4}','{r5}')")
committed_a = f"{r2}=20.00,{r3}=31.00,{r4}=41.00,{r5}=50.00"
committed_b = f"{r2}=22.00,{r3}=4.00,{r4}=40.00,{r5}=51.00"
assert values in (committed_a, committed_b), f"deadlocked transaction partially applied or retried: {values}"

# Cascaded zone deletion bumps its merchant; merchant deletion removes revision
# state and child cascades cannot recreate it.
before = revision(m2)
run(PSQL + ["-c", f"DELETE FROM public.merchant_shipping_zones WHERE id='{z2}'"])
assert revision(m2) > before, "zone/rate cascade did not advance merchant revision"
run(PSQL + ["-c", f"DELETE FROM public.merchants WHERE id='{m1}'"])
assert scalar(f"SELECT count(*) FROM public.merchant_shipping_config_revisions WHERE merchant_id='{m1}'") == "0", "merchant deletion left/recreated revision"

# The private revision is protected from all API roles.
assert scalar("SELECT relrowsecurity FROM pg_class WHERE oid='public.merchant_shipping_config_revisions'::regclass") == "t", "revision table RLS is disabled"
assert scalar("SELECT count(*) FROM pg_policy WHERE polrelid='public.merchant_shipping_config_revisions'::regclass") == "0", "revision table unexpectedly has a policy"
for role in ["anon", "authenticated", "service_role"]:
    assert scalar(f"SELECT has_table_privilege('{role}','public.merchant_shipping_config_revisions','SELECT')") == "f", f"{role} can read internal revisions"

print("merchant shipping config revision mutex, rollback, cascade and concurrency checks passed")
