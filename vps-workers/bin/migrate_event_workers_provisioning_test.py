from migrate_event_workers_test_support import (
    MigrationFixture, migration, os, pwd, grp, shutil, stat, subprocess, tempfile, Path, patch, json,
)


class MigrationProvisioningTests(MigrationFixture):

    def test_units_are_separate_fixed_system_services_for_baci_worker(self):
        contents = migration._unit_contents(self.paths)
        self.assertEqual(set(contents), {f"{name}.service" for name in migration.SERVICES})
        for name, data in contents.items():
            source = data.decode()
            self.assertIn("User=baci-worker", source)
            self.assertIn("Group=baci-worker", source)
            self.assertIn("BACI_WORKER_ENV=/srv/baci-workers/runtime/worker.env", source)
            self.assertIn("ProtectHome=true", source)
            self.assertNotIn("/home/bassey", source)
            self.assertIn("ExecStart=/usr/bin/flock", source)
        self.assertIn("process-domain-events.lock", contents["baci-domain-event-router.service"].decode())
        self.assertIn("process-event-deliveries.lock", contents["baci-event-delivery-worker.service"].decode())
        self.assertIn("quiz-finalize.lock", contents["baci-quiz-finalization.service"].decode())

    def test_migration_stops_legacy_before_starting_new_and_records_rollback_state(self):
        backup = self.migrate()
        state = json.loads((backup / "migration.json").read_text())
        self.assertEqual(state["legacy_states"], self.legacy_states)
        self.assertEqual(state["removed_schedules"], [
            "process-domain-events", "process-event-deliveries", "process-quiz-finalization", "quiz-finalize-route",
        ])
        self.assertNotIn("process-domain-events.sh", self.crontab)
        self.assertNotIn("process-event-deliveries.sh", self.crontab)
        self.assertNotIn("process-quiz-finalization.sh", self.crontab)
        self.assertNotIn("/api/quiz/finalize", self.crontab)
        self.assertIn("sync-gigl-service-centres.mjs", self.crontab)
        self.assertEqual(stat.S_IMODE((backup / "migration.json").stat().st_mode), 0o600)
        self.assertEqual(set(state["lock_inodes"]), set(migration.LOCKS.values()))
        for lock_name, before in self.lock_inode_state.items():
            info = (self.root / "locks" / lock_name).stat()
            self.assertEqual((info.st_dev, info.st_ino, info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)), before)
        for service in migration.SERVICES:
            self.assertTrue((self.unit_dir / f"{service}.service").is_file())
            if self.legacy_states[service]["active"]:
                self.assertIn(("legacy-systemctl", "stop", f"{service}.service"), self.calls)
            if self.legacy_states[service]["enabled"]:
                self.assertIn(("legacy-systemctl", "disable", f"{service}.service"), self.calls)
            self.assertIn(("systemctl", "enable", "--now", f"{service}.service"), self.calls)
        first_new = next(i for i, call in enumerate(self.calls) if call[:2] == ("systemctl", "enable"))
        last_old_stop = max(i for i, call in enumerate(self.calls) if call[:2] == ("legacy-systemctl", "stop"))
        drain_index = self.calls.index(("drain-worker-locks",))
        cron_write_index = self.calls.index(("write-crontab",))
        self.assertGreater(first_new, last_old_stop)
        self.assertGreater(drain_index, last_old_stop)
        self.assertLess(drain_index, first_new)
        self.assertLess(cron_write_index, last_old_stop)
        self.assertTrue(all((self.root / "locks" / name).is_file() for name in migration.LOCKS.values()))

    def test_failed_system_activation_removes_new_units_and_restores_legacy_states(self):
        failing_call = ("systemctl", "enable", "--now", "baci-quiz-finalization.service")
        with self.assertRaisesRegex(RuntimeError, "systemctl failed"):
            self.migrate(runner=self.runner(fail_on=failing_call))
        self.assertTrue(all(not (self.unit_dir / f"{service}.service").exists() for service in migration.SERVICES))
        for service, state in self.legacy_states.items():
            if state["enabled"]:
                self.assertIn(("legacy-systemctl", "enable", f"{service}.service"), self.calls)
            if state["active"]:
                self.assertIn(("legacy-systemctl", "start", f"{service}.service"), self.calls)
        self.assertIn(("systemctl", "daemon-reload"), self.calls)
        self.assertIn("process-domain-events.sh", self.crontab)

    def test_lock_drain_failure_restores_exact_crontab_before_reenabling_legacy_services(self):
        original_crontab = self.crontab

        def fail_drain(*_args, **_kwargs):
            self.calls.append(("drain-worker-locks",))
            raise RuntimeError("synthetic lock still held")

        with self.assertRaisesRegex(RuntimeError, "synthetic lock still held"):
            self.migrate(drain_locks=fail_drain)
        self.assertEqual(self.crontab, original_crontab)
        self.assertTrue(all(not (self.unit_dir / f"{service}.service").exists() for service in migration.SERVICES))
        self.assertTrue(all(("legacy-systemctl", "start", f"{service}.service") in self.calls
                            for service, state in self.legacy_states.items() if state["active"]))
        restore_index = max(index for index, call in enumerate(self.calls) if call == ("write-crontab",))
        first_legacy_start = min(index for index, call in enumerate(self.calls)
                                 if call[:2] == ("legacy-systemctl", "start"))
        self.assertLess(restore_index, first_legacy_start)

    def test_partial_legacy_restore_reports_reconciliation(self):
        def fail_drain(*_args, **_kwargs):
            raise RuntimeError("synthetic lock still held")

        with patch.object(migration, "_restore_legacy", side_effect=RuntimeError("legacy start failed")):
            with self.assertRaisesRegex(RuntimeError, "legacy service restoration is partial; manual reconciliation"):
                self.migrate(drain_locks=fail_drain)
        self.assertIn("process-domain-events.sh", self.crontab)

    def test_changed_lock_namespace_prevents_crontab_restore_and_legacy_restart(self):
        def replace_lock_then_fail(root, **_kwargs):
            lock = root / "locks" / next(iter(migration.LOCKS.values()))
            lock.unlink()
            lock.touch(mode=0o660)
            os.chmod(lock, 0o660)
            os.chown(lock, os.getuid(), os.getgid())
            raise RuntimeError("synthetic lock still held")

        with self.assertRaisesRegex(RuntimeError, "protected lock state is uncertain; legacy services remain disabled"):
            self.migrate(drain_locks=replace_lock_then_fail)
        self.assertNotIn("process-domain-events.sh", self.crontab)
        self.assertNotIn("process-event-deliveries.sh", self.crontab)
        self.assertNotIn("process-quiz-finalization.sh", self.crontab)
        self.assertFalse(any(call[:2] == ("legacy-systemctl", "start") for call in self.calls))
        self.assertEqual(self.calls.count(("write-crontab",)), 1)

    def test_existing_system_unit_refuses_overwrite_before_stopping_legacy(self):
        existing = self.unit_dir / "baci-domain-event-router.service"
        existing.write_text("operator unit\n")
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            self.migrate()
        self.assertFalse(any(call[:1] == ("legacy-systemctl",) for call in self.calls))
        self.assertEqual(existing.read_text(), "operator unit\n")

    def test_tampered_unit_source_fails_reviewed_hash_gate(self):
        source = self.unit_sources / "baci-domain-event-router.service"
        source.write_text(source.read_text() + "ExecStartPre=/bin/sh -c id\n")
        with self.assertRaisesRegex(RuntimeError, "reviewed fixed unit"):
            migration.migrate(paths=self.paths, runner=self.runner(), verify=lambda _root: (710, os.getgid()),
                              snapshot=lambda **_kwargs: self.legacy_states,
                              root_uid=os.getuid(), root_gid=os.getgid())
        self.assertEqual(self.calls, [])

    def test_removes_all_duplicate_legacy_rows_and_preserves_unrelated_schedule_bytes(self):
        duplicate = "* * * * * flock -n /srv/baci-workers/locks/process-domain-events.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=event-pipeline && cd /home/bassey/baci-workers && /home/bassey/baci-workers/bin/process-domain-events.sh --once' >> /home/bassey/baci-workers/logs/process-domain-events.log 2>&1\n"
        unrelated = "# keep this comment byte-for-byte\n17 4 * * * /opt/other-job\n"
        migrated, names = migration.remove_legacy_worker_cron_rows(unrelated + duplicate + duplicate)
        self.assertEqual(migrated, unrelated)
        self.assertEqual(names, ["process-domain-events", "process-domain-events"])

    def test_migration_refuses_ambiguous_legacy_worker_command_without_touching_cron(self):
        original = self.crontab
        self.crontab = original.replace("process-domain-events.sh --once", "process-domain-events.sh --unsafe")
        unsafe_crontab = self.crontab
        with self.assertRaisesRegex(RuntimeError, "outside the fixed cleanup contract"):
            self.migrate()
        self.assertEqual(self.crontab, unsafe_crontab)
        self.assertFalse(any(call == ("write-crontab",) for call in self.calls))

    def test_migration_requires_preexisting_baci_locks_inodes_and_never_repairs_them(self):
        lock = self.root / "locks" / next(iter(migration.LOCKS.values()))
        before = lock.stat()
        backup = self.migrate()
        self.assertTrue((backup / "migration.json").is_file())
        after = lock.stat()
        self.assertEqual((after.st_dev, after.st_ino, after.st_uid, after.st_gid, stat.S_IMODE(after.st_mode)),
                         (before.st_dev, before.st_ino, before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode)))

    def test_missing_or_wrong_group_lock_fails_before_cron_or_unit_mutation(self):
        lock = self.root / "locks" / next(iter(migration.LOCKS.values()))
        lock.unlink()
        with self.assertRaisesRegex(RuntimeError, "protected worker lock"):
            self.migrate()
        self.assertEqual(self.crontab.count("process-domain-events.sh"), 1)
        self.assertEqual(self.calls, [])

        lock.touch(mode=0o660)
        os.chmod(lock, 0o660)
        real_getgrnam = migration.grp.getgrnam
        def wrong_lock_group(name):
            if name == "baci-locks":
                return grp.struct_group((name, "x", os.getgid() + 1, []))
            return real_getgrnam(name)
        with patch.object(migration.grp, "getgrnam", side_effect=wrong_lock_group):
            with self.assertRaisesRegex(RuntimeError, "protected worker lock"):
                self.migrate()
        self.assertEqual(self.crontab.count("process-domain-events.sh"), 1)
        self.assertEqual(self.calls, [])

    def test_atomic_unit_install_failure_leaves_no_partial_target_or_temp(self):
        target = self.unit_dir / "partial.service"
        with patch.object(migration.os, "link", side_effect=OSError("synthetic link failure")):
            with self.assertRaisesRegex(OSError, "synthetic link failure"):
                migration._install_unit_atomically(target, b"unit contents\n", root_uid=os.getuid(), root_gid=os.getgid())
        self.assertFalse(target.exists())
        self.assertEqual(list(self.unit_dir.glob(".baci-unit-*")), [])

    def test_legacy_stop_failure_prevents_new_system_units_from_starting(self):
        failing_call = ("legacy-systemctl", "stop", "baci-domain-event-router.service")
        with self.assertRaisesRegex(RuntimeError, "legacy-systemctl failed"):
            self.migrate(runner=self.runner(fail_on=failing_call))
        self.assertFalse(any(call[:2] == ("systemctl", "enable") for call in self.calls))
        self.assertTrue(all(not (self.unit_dir / f"{service}.service").exists() for service in migration.SERVICES))

    def test_ambiguous_new_unit_stop_retains_files_and_does_not_restart_legacy(self):
        failing_calls = {
            ("systemctl", "enable", "--now", "baci-quiz-finalization.service"),
            ("systemctl", "disable", "--now", "baci-quiz-finalization.service"),
        }
        with self.assertRaisesRegex(RuntimeError, "new system worker state is ambiguous"):
            self.migrate(runner=self.runner(fail_on=failing_calls))
        self.assertTrue(all((self.unit_dir / f"{service}.service").exists() for service in migration.SERVICES))
        self.assertFalse(any(call[:2] == ("legacy-systemctl", "start") for call in self.calls))


if __name__ == "__main__":
    unittest.main()
