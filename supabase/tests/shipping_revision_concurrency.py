"""Concurrency probes for the merchant shipping revision SQL harness."""
import os
import subprocess
import time
from pathlib import Path


def psql_include(path):
    quoted_path = str(path).replace("\\", "\\\\").replace("'", "''")
    return f"\\i '{quoted_path}'"


def verify_migration_seed_race(root, psql, scalar, revision):
    migration_path = root / "supabase/migrations/20261106150100_merchant_shipping_config_revision.sql"
    migration_sql = migration_path.read_text()
    backfill = "INSERT INTO public.merchant_shipping_config_revisions (merchant_id, revision)\nSELECT id, 1 FROM public.merchants"
    assert migration_sql.index("CREATE TRIGGER initialize_merchant_shipping_config_revision") < migration_sql.index(backfill), (
        "merchant initialization trigger must precede revision backfill"
    )

    race_merchant = "10000000-0000-4000-8000-000000000099"
    writer = subprocess.Popen(
        psql + ["-c", f"SET application_name='shipping_revision_race_writer'; INSERT INTO public.merchants(id,slug) VALUES ('{race_merchant}','merchant-race'); SELECT pg_sleep(1.5)"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    writer_deadline = time.monotonic() + 5
    while time.monotonic() < writer_deadline:
        if scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='shipping_revision_race_writer' AND state='active'") == "1":
            break
        time.sleep(0.05)
    else:
        raise AssertionError("concurrent merchant insert did not start")

    migration = subprocess.Popen(
        psql + ["-c", psql_include(migration_path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    observed_lock_wait = False
    migration_deadline = time.monotonic() + 8
    while time.monotonic() < migration_deadline:
        if scalar("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%CREATE TRIGGER initialize_merchant_shipping_config_revision%'") == "1":
            observed_lock_wait = True
            break
        if migration.poll() is not None:
            break
        time.sleep(0.05)
    assert observed_lock_wait, "migration finished without contending with the in-flight merchant insert"

    writer_out, writer_err = writer.communicate(timeout=8)
    assert writer.returncode == 0, f"concurrent merchant insert failed: {writer_err or writer_out}"
    migration_out, migration_err = migration.communicate(timeout=10)
    assert migration.returncode == 0, f"migration failed: {migration_err or migration_out}"
    assert revision(race_merchant) == 1, "merchant committed during trigger installation was missed by backfill"


def verify_projection_locking(bin_dir, psql, scalar, revision, run, r1, r3, m1, m2):
    reader_sql = f"BEGIN; SELECT public.get_storefront_shipping_rates('{m2}'); SELECT pg_sleep(2.0); COMMIT"
    reader = subprocess.Popen(
        [str(bin_dir / "psql"), *psql[1:], "-c", reader_sql],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "PGAPPNAME": "shipping_reader_m2"},
    )
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='shipping_reader_m2' AND wait_event='PgSleep'") == "1":
            break
        time.sleep(0.03)
    else:
        raise AssertionError("reader did not retain its shared revision lock")

    start = time.monotonic()
    scalar(f"SELECT public.get_storefront_shipping_rates('{m2}') ->> 'shipping_config_revision'")
    assert time.monotonic() - start < 0.7, "same-merchant quote readers serialized"
    start = time.monotonic()
    run(psql + ["-c", f"UPDATE public.merchant_shipping_rates SET base_amount=13 WHERE id='{r1}'"])
    writer_waited = time.monotonic() - start
    reader.communicate(timeout=10)
    assert reader.returncode == 0 and writer_waited >= 0.7, "config writer did not wait for active quote snapshot"

    writer_sql = f"BEGIN; UPDATE public.merchant_shipping_rates SET base_amount=12 WHERE id='{r1}'; SELECT pg_sleep(1.4); COMMIT"
    writer = subprocess.Popen(
        [str(bin_dir / "psql"), *psql[1:], "-c", writer_sql],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "PGAPPNAME": "shipping_writer_m2"},
    )
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='shipping_writer_m2' AND wait_event='PgSleep'") == "1":
            break
        time.sleep(0.03)
    else:
        raise AssertionError("writer did not reach its held-revision interval")

    start = time.monotonic()
    run(psql + ["-c", f"UPDATE public.merchant_shipping_rates SET base_amount=4 WHERE id='{r3}'"])
    assert time.monotonic() - start < 0.7, "merchant m1 write waited on merchant m2 revision"
    quote_sql = f"SELECT (payload->>'shipping_config_revision') || ':' || (SELECT rate->>'base_amount' FROM jsonb_array_elements(payload->'rates') AS rate WHERE rate->>'id'='{r1}') FROM (SELECT public.get_storefront_shipping_rates('{m2}') AS payload) AS quote"
    start = time.monotonic()
    quote = scalar(quote_sql)
    writer.communicate(timeout=10)
    assert writer.returncode == 0, "config writer failed"
    assert time.monotonic() - start >= 0.7, "same-merchant projection did not wait for writer commit"
    quote_revision, quote_amount = quote.split(":")
    assert int(quote_revision) == revision(m2) and quote_amount == "12.00", f"projection mixed config and revision: {quote}"


def verify_deadlock_fails_closed(bin_dir, psql, scalar, r2, r3, r4, r5):
    sql_a = f"BEGIN; UPDATE public.merchant_shipping_rates SET base_amount=31 WHERE id='{r3}'; SELECT pg_sleep(0.45); UPDATE public.merchant_shipping_rates SET base_amount=41 WHERE id='{r4}'; COMMIT"
    sql_b = f"BEGIN; UPDATE public.merchant_shipping_rates SET base_amount=22 WHERE id='{r2}'; SELECT pg_sleep(0.45); UPDATE public.merchant_shipping_rates SET base_amount=51 WHERE id='{r5}'; COMMIT"
    verbose_psql = [str(bin_dir / "psql"), *psql[1:3], "-v", "VERBOSITY=verbose", *psql[3:]]
    first = subprocess.Popen(
        verbose_psql + ["-c", sql_a], text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={**os.environ, "PGAPPNAME": "shipping_multi_tx_a"},
    )
    time.sleep(0.12)
    second = subprocess.Popen(
        verbose_psql + ["-c", sql_b], text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={**os.environ, "PGAPPNAME": "shipping_multi_tx_b"},
    )
    first_out = first.communicate(timeout=10)
    second_out = second.communicate(timeout=10)
    assert "40P01" in first_out[1] or "40P01" in second_out[1], "opposite-order contention did not fail closed"
    assert (first.returncode == 0) != (second.returncode == 0), "expected exactly one multi-tenant transaction to abort"
    values = scalar(f"SELECT string_agg(id::text||'='||base_amount::text,',' ORDER BY id) FROM public.merchant_shipping_rates WHERE id IN ('{r2}','{r3}','{r4}','{r5}')")
    committed_a = f"{r2}=20.00,{r3}=31.00,{r4}=41.00,{r5}=50.00"
    committed_b = f"{r2}=22.00,{r3}=4.00,{r4}=40.00,{r5}=51.00"
    assert values in (committed_a, committed_b), f"deadlocked transaction partially applied or retried: {values}"
