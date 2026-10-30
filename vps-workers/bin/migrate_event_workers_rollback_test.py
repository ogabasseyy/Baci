from migrate_event_workers_test_support import (
    MigrationFixture, migration, os, pwd, grp, shutil, stat, subprocess, tempfile, Path, patch, json,
)


class MigrationRollbackTests(MigrationFixture):

    def test_rollback_refuses_crontab_drift_before_disabling_system_units(self):
        backup = self.migrate()
        self.crontab += "# operator edit after migration\n"
        self.calls.clear()
        with self.assertRaisesRegex(RuntimeError, "crontab changed since migration"):
            self.rollback(backup)
        self.assertEqual(self.calls, [])

    def test_rollback_refuses_changed_system_unit_without_mutation(self):
        backup = self.migrate()
        target = self.unit_dir / "baci-event-delivery-worker.service"
        target.write_text(target.read_text() + "# local change\n")
        self.calls.clear()
        with self.assertRaisesRegex(RuntimeError, "changed since migration"):
            self.rollback(backup)
        self.assertEqual(self.calls, [])
        self.assertTrue(target.exists())

    def test_rollback_removes_matching_system_units_and_restores_legacy_state(self):
        backup = self.migrate()
        self.calls.clear()
        self.rollback(backup)
        self.assertTrue(all(not (self.unit_dir / f"{service}.service").exists() for service in migration.SERVICES))
        self.assertIn("process-domain-events.sh", self.crontab)
        self.assertIn("sync-gigl-service-centres.mjs", self.crontab)
        last_system_stop = max(index for index, call in enumerate(self.calls)
                               if call[:2] == ("systemctl", "disable"))
        cron_restore = self.calls.index(("write-crontab",))
        first_legacy_start = min(index for index, call in enumerate(self.calls)
                                 if call[:2] == ("legacy-systemctl", "start"))
        self.assertLess(last_system_stop, cron_restore)
        self.assertLess(cron_restore, first_legacy_start)
        for service, state in self.legacy_states.items():
            if state["active"]:
                self.assertIn(("legacy-systemctl", "start", f"{service}.service"), self.calls)
            else:
                self.assertIn(("legacy-systemctl", "stop", f"{service}.service"), self.calls)
        for lock_name, before in self.lock_inode_state.items():
            info = (self.root / "locks" / lock_name).stat()
            self.assertEqual((info.st_dev, info.st_ino, info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)), before)

    def test_rollback_refuses_lock_inode_replacement_before_disabling_system_units(self):
        backup = self.migrate()
        lock = self.root / "locks" / next(iter(migration.LOCKS.values()))
        lock.unlink()
        lock.touch(mode=0o660)
        os.chmod(lock, 0o660)
        os.chown(lock, os.getuid(), os.getgid())
        self.calls.clear()
        with self.assertRaisesRegex(RuntimeError, "lock inode changed since migration"):
            self.rollback(backup)
        self.assertEqual(self.calls, [])

    def test_rollback_reports_partial_legacy_service_restoration(self):
        backup = self.migrate()
        self.calls.clear()
        with patch.object(migration, "_restore_legacy", side_effect=RuntimeError("legacy start failed")):
            with self.assertRaisesRegex(RuntimeError, "legacy service restoration is partial; manual reconciliation"):
                self.rollback(backup)
        self.assertIn("process-domain-events.sh", self.crontab)
        self.assertTrue(all(not (self.unit_dir / f"{service}.service").exists() for service in migration.SERVICES))

    def test_rollback_refuses_when_legacy_service_was_reenabled(self):
        backup = self.migrate()
        self.calls.clear()
        current = {service: {"active": False, "enabled": service == "baci-domain-event-router"}
                   for service in migration.SERVICES}
        with self.assertRaisesRegex(RuntimeError, "active or enabled"):
            self.rollback(backup, snapshot=lambda **_kwargs: current)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
