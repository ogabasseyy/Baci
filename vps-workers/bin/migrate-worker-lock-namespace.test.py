import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('migrate-worker-lock-namespace.py')
SPEC = importlib.util.spec_from_file_location('migrate_worker_lock_namespace', SCRIPT)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)


class RewriteTests(unittest.TestCase):
    def test_rewrites_only_lock_operands_and_preserves_schedule_and_commands(self):
        original = (
            '# keep comment\n'
            '*/5 * * * * flock -n /home/bassey/baci-workers/locks/gigl-tracking.lock '
            "bash -lc 'export X=1 && cd /home/bassey/baci-workers && node jobs/job.mjs' >> /tmp/job.log 2>&1\n"
            '17 4 * * * flock -n /tmp/unrelated.lock true\n'
        )
        rewritten, names = MIGRATION.rewrite_crontab(original)
        self.assertEqual(names, ['gigl-tracking.lock'])
        self.assertEqual(rewritten, original.replace(
            '/home/bassey/baci-workers/locks/gigl-tracking.lock',
            '/srv/baci-workers/locks/gigl-tracking.lock'))
        self.assertIn("cd /home/bassey/baci-workers && node jobs/job.mjs", rewritten)
        self.assertIn('*/5 * * * *', rewritten)
        self.assertIn('/tmp/unrelated.lock', rewritten)

    def test_is_idempotent_and_refuses_other_locks_namespaces(self):
        once, names = MIGRATION.rewrite_crontab(
            '0 1 * * * flock -n /home/bassey/baci-workers/locks/a.lock true\n')
        twice, names2 = MIGRATION.rewrite_crontab(once)
        self.assertEqual((twice, names2), (once, names))
        with self.assertRaisesRegex(MIGRATION.MigrationError, 'outside both fixed namespaces'):
            MIGRATION.rewrite_crontab(
                '0 1 * * * flock -n /tmp/baci-workers/locks/a.lock true\n')
        with self.assertRaisesRegex(MIGRATION.MigrationError, 'relative worker lock'):
            MIGRATION.rewrite_crontab('0 1 * * * flock -n locks/a.lock true\n')

    def test_suspends_only_rows_using_the_legacy_lock_path(self):
        source = ('0 1 * * * flock -n /home/bassey/baci-workers/locks/a.lock /bin/true\n'
                  '0 2 * * * /bin/true\n'
                  '0 3 * * * flock -n /srv/baci-workers/locks/b.lock /bin/true\n')
        suspended = MIGRATION.suspend_legacy_lines(source)
        self.assertTrue(suspended.startswith('# baci-lock-migration: 0 1'))
        self.assertIn('0 2 * * * /bin/true\n', suspended)
        self.assertIn('0 3 * * * flock -n /srv/', suspended)


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.old = (
            '*/5 * * * * flock -n /home/bassey/baci-workers/locks/a.lock '
            'bash -lc \'cd /home/bassey/baci-workers && node jobs/a.mjs\'\n'
        )
        self.new, self.names = MIGRATION.rewrite_crontab(self.old)
        self.current = self.old
        self.events = []
        self.active = [MIGRATION.CRON_UNIT, 'baci-gigl-tracking.timer',
                       'baci-gigl-tracking.service']

    def run_migration(self, *, drain=None, write_failure=False):
        def write(value):
            self.events.append(('write', value))
            if write_failure and value == self.new:
                self.current = 'operator concurrent edit\n'
            else:
                self.current = value

        with patch.object(MIGRATION.os, 'geteuid', return_value=0), \
             patch.object(MIGRATION, '_read_crontab', side_effect=lambda: self.current), \
             patch.object(MIGRATION, '_write_crontab', side_effect=write), \
             patch.object(MIGRATION, '_snapshot_unit_states', side_effect=lambda: self.active), \
             patch.object(MIGRATION, '_stop_units', side_effect=lambda units: self.events.append(('stop', tuple(units)))), \
             patch.object(MIGRATION, '_start_units', side_effect=lambda units: self.events.append(('start', tuple(units)))), \
             patch.object(MIGRATION, '_ensure_directory'), \
             patch.object(MIGRATION, '_protect_legacy_lock_files'), \
             patch.object(MIGRATION, '_reload_cron', side_effect=lambda: self.events.append(('reload',))):
            return MIGRATION.migrate(
                group_setup=lambda: self.events.append(('group',)) or 4242,
                layout_setup=lambda root, names, gid: self.events.append(('layout', tuple(names), gid)),
                drain_check=drain or (lambda names: self.events.append(('drain', tuple(names)))),
            )

    def test_stops_fixed_units_drains_then_rewrites_and_restarts(self):
        self.assertEqual(self.run_migration(), self.names)
        self.assertEqual(self.current, self.new)
        self.assertEqual([event[0] for event in self.events],
                         ['write', 'reload', 'stop', 'group', 'layout', 'drain', 'write', 'reload', 'start'])
        self.assertIn(('layout', tuple(self.names), 4242), self.events)
        self.assertEqual(self.events[2][1], tuple(self.active))
        self.assertEqual(self.events[-1][1], tuple(self.active))

    def test_failed_drain_does_not_rewrite_crontab_and_restores_prior_units(self):
        with self.assertRaisesRegex(MIGRATION.MigrationError, 'could not drain'):
            self.run_migration(drain=lambda _names: (_ for _ in ()).throw(
                MIGRATION.MigrationError('could not drain')))
        self.assertEqual(self.current, self.old)
        self.assertEqual(self.current, self.old)
        self.assertEqual(self.events[-1], ('start', tuple(self.active)))

    def test_detects_operator_crontab_change_before_commit(self):
        def change_during_drain(_names):
            self.current = 'operator concurrent edit\n'
        with self.assertRaisesRegex(MIGRATION.MigrationError, 'changed during lock migration'):
            self.run_migration(drain=change_during_drain)
        self.assertEqual(self.current, 'operator concurrent edit\n')
        self.assertEqual(self.events[-1], ('start', tuple(self.active)))

    def test_readback_mismatch_rolls_back_only_its_candidate(self):
        with self.assertRaisesRegex(MIGRATION.MigrationError, 'did not verify'):
            self.run_migration(write_failure=True)
        # The concurrent operator edit is not overwritten by rollback.
        self.assertEqual(self.current, 'operator concurrent edit\n')
        self.assertEqual(self.events[-1], ('start', tuple(self.active)))

    def test_cron_reload_signals_without_stopping_host_cron(self):
        calls = []
        with patch.object(MIGRATION, '_systemctl', side_effect=lambda *args, **kwargs: calls.append(args)):
            MIGRATION._reload_cron()
        self.assertEqual(calls, [('kill', '--signal=HUP', '--kill-who=main', MIGRATION.CRON_UNIT)])

    def test_active_or_enabled_legacy_user_services_block_migration(self):
        def user_systemctl(*args):
            if args == ('show-environment',):
                return subprocess.CompletedProcess(args, 0, '', '')
            return subprocess.CompletedProcess(args, 0 if args[-1] == MIGRATION.USER_WORKER_UNITS[0] and args[0] == 'is-active' else 3, '', '')
        with patch.object(MIGRATION, '_user_systemctl', side_effect=user_systemctl):
            with self.assertRaisesRegex(MIGRATION.MigrationError, 'must be stopped and disabled'):
                MIGRATION._assert_user_units_inactive_and_disabled()

    def test_unavailable_user_manager_blocks_migration(self):
        with patch.object(MIGRATION, '_user_systemctl',
                          return_value=subprocess.CompletedProcess((), 1, '', '')):
            with self.assertRaisesRegex(MIGRATION.MigrationError, 'cannot establish bassey user'):
                MIGRATION._assert_user_units_inactive_and_disabled()

    def test_already_migrated_crontab_still_checks_user_units(self):
        with patch.object(MIGRATION.os, 'geteuid', return_value=0), \
             patch.object(MIGRATION, '_read_crontab', return_value=self.new), \
             patch.object(MIGRATION, '_assert_user_units_inactive_and_disabled',
                          side_effect=MIGRATION.MigrationError('legacy user service active')):
            with self.assertRaisesRegex(MIGRATION.MigrationError, 'legacy user service active'):
                MIGRATION.migrate()

    def test_queued_launcher_outside_worker_cgroup_blocks_drain(self):
        with patch.object(MIGRATION, '_old_lock_inodes', return_value=set()), \
             patch.object(MIGRATION, '_external_lock_fds', return_value=[]), \
             patch.object(MIGRATION, '_external_legacy_launchers', return_value=['4321:cmdline']), \
             patch.object(MIGRATION.time, 'monotonic', side_effect=[0, 31]), \
             patch.object(MIGRATION.time, 'sleep'):
            with self.assertRaisesRegex(MIGRATION.MigrationError, 'queued launcher remains'):
                MIGRATION._assert_cron_drain(['a.lock'])

    def test_proc_descriptor_permission_failure_fails_closed(self):
        with patch.object(MIGRATION.os, 'listdir', side_effect=PermissionError):
            with self.assertRaisesRegex(MIGRATION.MigrationError, 'cannot enumerate process descriptors'):
                MIGRATION._external_lock_fds({(1, 2)})

    def test_partial_worker_stop_restarts_every_unit_already_stopped(self):
        active = [unit for unit in MIGRATION.WORKER_UNITS if unit.endswith('.service')]
        operations = []

        def systemctl(*args, **_kwargs):
            operations.append(args)
            if args == ('stop', active[1]):
                raise MIGRATION.MigrationError('stop failed')

        with patch.object(MIGRATION, '_systemctl', side_effect=systemctl), \
             patch.object(MIGRATION, '_start_units', side_effect=lambda units: operations.append(('restore', tuple(units)))):
            with self.assertRaisesRegex(MIGRATION.MigrationError, 'stop failed'):
                MIGRATION._stop_units(active)
        self.assertIn(('restore', (active[0],)), operations)

    def test_worker_start_failure_retries_committed_scope(self):
        starts = []

        def start(units):
            starts.append(tuple(units))
            if len(starts) == 1:
                raise MIGRATION.MigrationError('transient start failure')

        with patch.object(MIGRATION.os, 'geteuid', return_value=0), \
             patch.object(MIGRATION, '_read_crontab', side_effect=lambda: self.current), \
             patch.object(MIGRATION, '_write_crontab', side_effect=lambda value: setattr(self, 'current', value)), \
             patch.object(MIGRATION, '_snapshot_unit_states', side_effect=lambda: self.active), \
             patch.object(MIGRATION, '_stop_units'), \
             patch.object(MIGRATION, '_start_units', side_effect=start), \
             patch.object(MIGRATION, '_reload_cron'), \
             patch.object(MIGRATION, '_ensure_directory'), \
             patch.object(MIGRATION, '_protect_legacy_lock_files'), \
             patch.object(MIGRATION, '_old_lock_inodes', return_value=set()), \
             patch.object(MIGRATION, '_assert_cron_drain'):
            with self.assertRaisesRegex(MIGRATION.MigrationError, 'needed one recovery retry'):
                MIGRATION.migrate(group_setup=lambda: 4242,
                    layout_setup=lambda *_args: None,
                    drain_check=lambda _names: None)
        self.assertEqual(self.current, self.new)
        self.assertEqual(len(starts), 2)
        self.assertEqual(starts[0], starts[1])


if __name__ == '__main__':
    unittest.main()
