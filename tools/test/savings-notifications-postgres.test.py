import argparse
from concurrent.futures import ThreadPoolExecutor
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path


def main():
    """Run the notification SQL contracts against a disposable database."""
    parser = argparse.ArgumentParser()
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--container")
    target.add_argument("--owned-temp-postgres", action="store_true")
    parser.add_argument("--postgres-bin", type=Path, default=os.environ.get("POSTGRES_BIN"))
    args = parser.parse_args()
    if args.container and not args.container.startswith("supabase_db_"):
        parser.error("Use a disposable local Supabase Docker container")
    root = Path(__file__).resolve().parents[2]
    migrations = root / "supabase/migrations"
    database = "baci_engagement_test_" + uuid.uuid4().hex
    temporary = None
    startup_attempted = False
    clean_environment = {key: value for key, value in os.environ.items() if not key.startswith("PG")}

    def run_command(command, **options):
        options.setdefault("timeout", 120)
        if args.owned_temp_postgres:
            options.setdefault("env", clean_environment)
        return subprocess.run(command, **options)

    if args.owned_temp_postgres:
        postgres_bin = args.postgres_bin
        if postgres_bin is None:
            postgres_bin = Path(subprocess.check_output(
                ["pg_config", "--bindir"], text=True, env=clean_environment, timeout=15
            ).strip())
        else:
            postgres_bin = Path(postgres_bin)
        temporary = Path(tempfile.mkdtemp(prefix="baci-pg-", dir="/tmp"))
        socket_dir = temporary / "socket"
        socket_dir.mkdir(mode=0o700)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        command_prefix = []
        psql = [
            str(postgres_bin / "psql"), "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
            "-h", str(socket_dir), "-p", str(port), "-U", "postgres", "-d", database,
        ]
    else:
        command_prefix = ["docker", "exec", "-i", "-u", "postgres", args.container]
        psql = command_prefix + ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", database]

    def sql(source):
        result = run_command(
            psql,
            input=source, text=True, capture_output=True, check=True,
        )
        return result.stdout.strip()

    try:
        if temporary is not None:
            # initdb can leave child processes or partial state after a timeout.
            startup_attempted = True
            run_command([
                str(postgres_bin / "initdb"), "-D", str(temporary / "data"),
                "-A", "trust", "-U", "postgres", "--no-locale", "--encoding=UTF8",
            ], check=True, capture_output=True, text=True, timeout=45)
            run_command([
                str(postgres_bin / "pg_ctl"), "-D", str(temporary / "data"),
                "-l", str(temporary / "postgres.log"), "-o",
                f"-k {socket_dir} -h '' -p {port}", "-w", "start",
            ], check=True, capture_output=True, text=True, timeout=45)
            run_command([
                str(postgres_bin / "createdb"), "-h", str(socket_dir), "-p", str(port),
                "-U", "postgres", database,
            ], check=True, capture_output=True, text=True, timeout=30)
            sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;")
        else:
            run_command(command_prefix + ["createdb", database], check=True)
        sources = [
            "tests/customer_savings_engagement.fixture.sql",
            "20260912120000_piggyvest_savings_ledger_tables.sql",
            "20260925130050_customer_savings_engagement_storage.sql",
            "20260925130100_customer_savings_engagement_events.sql",
            "20260925130200_customer_savings_engagement_delivery.sql",
            "20260925130300_customer_savings_notification_receipts.sql",
            "20261004130000_push_retryable_outcome.sql",
            "20261004140000_claim_push_tokenless_retry.sql",
            "20261004150000_push_retry_schedule.sql",
            "20261004171000_finish_push_unregistered.sql",
            "tests/finish_push_unregistered.sql",
            "20261006080000_push_delivery_retry_backoff.sql",
            "tests/customer_savings_engagement.sql",
            "tests/customer_savings_engagement_schedule.sql",
            "../../tools/test/savings-notifications-current.sql",
            "tests/customer_savings_engagement_concurrency.sql",
        ]
        for source in sources:
            sql((migrations / source).read_text())
            print("PASS", source)

        barrier = threading.Barrier(8)

        def claim(_index):
            barrier.wait(timeout=30)
            return int(sql("SELECT count(*) FROM savings_notifications.claim_push(1);"))

        with ThreadPoolExecutor(max_workers=8) as executor:
            claimed = list(executor.map(claim, range(8)))
        assert sum(claimed) == 1, "Concurrent workers must respect the daily customer cap"
        assert sql("SELECT count(*) FROM savings_notifications.deliveries WHERE status='dispatching';") == "1"
        assert sql("SELECT count(*) FROM savings_notifications.claim_push(100);") == "0"
        print("PASS eight concurrent workers: one encouragement, no replay")
    except BaseException as error:
        primary_error = error
        if isinstance(error, subprocess.CalledProcessError):
            print(error.stderr or "PostgreSQL rehearsal failed")
        raise
    finally:
        if temporary is None:
            try:
                run_command(command_prefix + ["dropdb", "--force", database], check=True)
            except BaseException as cleanup_error:
                if "primary_error" not in locals():
                    raise
                print(
                    f"PostgreSQL cleanup failed for owned database {database} "
                    f"({type(cleanup_error).__name__})",
                    file=sys.stderr,
                )
        else:
            pid_file = temporary / "data/postmaster.pid"
            cleanup_error = None
            if startup_attempted or pid_file.exists():
                try:
                    run_command([
                        str(postgres_bin / "pg_ctl"), "-D", str(temporary / "data"),
                        "-m", "fast", "-w", "stop",
                    ], check=True, capture_output=True, text=True, timeout=45)
                    if pid_file.exists():
                        raise RuntimeError("PostgreSQL stop returned but its PID file remains")
                except BaseException as error:
                    cleanup_error = error
            if cleanup_error is None:
                shutil.rmtree(temporary)
            else:
                print(
                    f"PostgreSQL cleanup failed; preserving private PostgreSQL directory {temporary} "
                    f"({type(cleanup_error).__name__})",
                    file=sys.stderr,
                )
                if "primary_error" not in locals():
                    raise RuntimeError(
                        f"PostgreSQL did not stop; private data preserved at {temporary}"
                    ) from cleanup_error


if __name__ == "__main__":
    main()
