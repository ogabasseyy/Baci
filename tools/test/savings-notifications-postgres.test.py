import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import threading
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", required=True)
    args = parser.parse_args()
    if not args.container.startswith("supabase_db_"):
        parser.error("Use a disposable local Supabase Docker container")
    root = Path(__file__).resolve().parents[2]
    migrations = root / "supabase/migrations"
    database = "baci_engagement_test_" + uuid.uuid4().hex
    docker = ["docker", "exec", "-i", "-u", "postgres", args.container]

    def sql(source):
        result = subprocess.run(
            docker + ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", database],
            input=source, text=True, capture_output=True, check=True,
        )
        return result.stdout.strip()

    subprocess.run(docker + ["createdb", database], check=True)
    try:
        sources = [
            "tests/customer_savings_engagement.fixture.sql",
            "20260912120000_piggyvest_savings_ledger_tables.sql",
            "20260925130000_customer_savings_engagement_storage.sql",
            "20260925130100_customer_savings_engagement_events.sql",
            "20260925130200_customer_savings_engagement_delivery.sql",
            "20260925130300_customer_savings_notification_receipts.sql",
            "tests/customer_savings_engagement.sql",
            "tests/customer_savings_engagement_schedule.sql",
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
    except subprocess.CalledProcessError as error:
        print(error.stderr or "PostgreSQL rehearsal failed")
        raise
    finally:
        subprocess.run(docker + ["dropdb", database], check=True)


if __name__ == "__main__":
    main()
