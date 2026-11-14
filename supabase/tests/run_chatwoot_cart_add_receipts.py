#!/usr/bin/env python3
"""Run the Chatwoot add RPC contract in an owned disposable PostgreSQL cluster."""
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time
import os

ROOT = pathlib.Path(__file__).resolve().parents[2]
pg_config = os.environ.get("PG_CONFIG") or shutil.which("pg_config")
if not pg_config:
    raise SystemExit("pg_config not found; set PG_BINDIR to installed PostgreSQL binaries")
bindir = pathlib.Path(os.environ.get("PG_BINDIR") or subprocess.check_output([pg_config, "--bindir"], text=True).strip())
bins = {name: bindir / name for name in ("initdb", "pg_ctl", "psql")}
missing = [str(path) for path in bins.values() if not path.is_file()]
if missing:
    raise SystemExit("PostgreSQL binaries missing: " + ", ".join(missing))

with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
tmp = pathlib.Path(tempfile.mkdtemp(prefix="chatwoot-cart-add-pg-"))
(tmp / "sock").mkdir()
started = False
connection = [str(bins["psql"]), "-X", "-v", "ON_ERROR_STOP=1", "-h", str(tmp / "sock"), "-p", str(port), "-U", "postgres", "-d", "postgres"]
claims = '{"role":"commerce_cart_shopper","cart_scope":"session","exp":9999999999,"cart_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"buyer-a","cart_grant_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}'
try:
    with open(tmp / "init.log", "w") as log:
        subprocess.run([str(bins["initdb"]), "-D", str(tmp / "data"), "-U", "postgres", "--auth=trust", "--no-locale"], check=True, stdout=log, stderr=log)
        subprocess.run([str(bins["pg_ctl"]), "-D", str(tmp / "data"), "-l", str(tmp / "postgres.log"), "-o", f"-h '' -k {tmp / 'sock'} -p {port}", "start"], check=True, stdout=log, stderr=log)
        started = True
    subprocess.run(connection + ["-f", str(ROOT / "supabase/tests/chatwoot_cart_add_receipts.sql")], check=True, cwd=ROOT)

    first_sql = f"BEGIN; SET ROLE commerce_cart_shopper; SELECT set_config('request.jwt.claims', '{claims}', false); SELECT public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','concurrent-1',7,'unmanaged',NULL); SELECT pg_sleep(0.8); COMMIT;"
    second_sql = f"BEGIN; SET ROLE commerce_cart_shopper; SELECT set_config('request.jwt.claims', '{claims}', false); SELECT public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','concurrent-1',7,'unmanaged',NULL); COMMIT;"
    first = subprocess.Popen(connection + ["-At", "-c", first_sql], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT)
    time.sleep(0.1)
    second = subprocess.Popen(connection + ["-At", "-c", second_sql], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT)
    first_out, first_err = first.communicate(timeout=10)
    second_out, second_err = second.communicate(timeout=10)
    if first.returncode or second.returncode:
        raise RuntimeError(first_err + second_err)
    if '"replayed": true' not in second_out and '"replayed":true' not in second_out:
        raise RuntimeError("Concurrent duplicate did not replay: " + second_out)
    verification = subprocess.check_output(connection + ["-At", "-c", "SELECT count(*) || ':' || max(version) FROM public.commerce_cart_operations, public.commerce_carts WHERE operation_id='concurrent-1' AND commerce_carts.id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'"], text=True).strip()
    if verification != "1:8":
        raise RuntimeError("Concurrent add did not commit exactly once: " + verification)
    print("PASS: concurrent same-ID requests commit once and replay the canonical receipt")
finally:
    if started:
        subprocess.run([str(bins["pg_ctl"]), "-D", str(tmp / "data"), "stop", "-m", "fast"], check=True, stdout=subprocess.DEVNULL)
    shutil.rmtree(tmp, ignore_errors=True)
