import unittest
from unittest.mock import patch

import readiness_evidence_timers as timers


def fixture():
    artifacts, contents, loaded = {}, {}, {}
    for stem, stops in timers.STOPS.items():
        for suffix in ('.timer', '.service'):
            name = stem + suffix
            artifacts[name] = {'path': timers.PREFIX + name}
            common = {'FragmentPath': timers.PREFIX + name, 'DropInPaths': '',
                      'NeedDaemonReload': 'no', 'LoadState': 'loaded'}
            if suffix == '.timer':
                contents[name] = f'OnCalendar={timers.DATE}\nUnit={stem}.service\n'.encode()
                common.update(ActiveState='active', SubState='waiting', Unit=stem + '.service',
                    TimersCalendar='{ OnCalendar=' + timers.DATE + '; next_elapse=Tue ' + timers.DATE + ' }',
                    NextElapseUSecRealtime='Tue ' + timers.DATE)
            else:
                contents[name] = ''.join('ExecStart=' + entry + '\n' for entry in stops).encode()
                common['ExecStart'] = ' '.join('{ path=' + entry.split()[0] + '; argv[]=' + entry +
                    '; ignore_errors=no; start_time=[n/a]; }' for entry in stops)
            loaded[name] = common
    return artifacts, contents, loaded


class TimerEvidenceTests(unittest.TestCase):
    def collect(self, artifacts, contents, loaded):
        def run(args):
            return '\n'.join(key + '=' + value for key, value in loaded[args[-1]].items())
        with patch.object(timers, 'pinned', side_effect=lambda row: contents[row['path'].split('/')[-1]]):
            return timers.collect(artifacts, run)

    def test_collects_all_three_effective_deadlines_and_stop_targets(self):
        result = self.collect(*fixture())
        self.assertEqual(len(result), 3)
        self.assertTrue(all(row['stopTargetsVerified'] for row in result.values()))

    def test_refuses_old_deadline_dropins_pending_reload_or_stale_next_elapse(self):
        for key, value in (('DropInPaths', '/unapproved'), ('NeedDaemonReload', 'yes'),
                           ('NextElapseUSecRealtime', 'Tue 2026-09-29 15:59:10 UTC'), ('ActiveState', 'inactive')):
            artifacts, contents, loaded = fixture()
            loaded['baci-prefunded-deadline.timer'][key] = value
            with self.subTest(key=key), self.assertRaises(Exception):
                self.collect(artifacts, contents, loaded)

    def test_refuses_effective_stop_command_drift_even_with_pinned_fragment(self):
        artifacts, contents, loaded = fixture()
        loaded['baci-prefunded-replay-deadline.service']['ExecStart'] = '{ path=/bin/true; argv[]=/bin/true; ignore_errors=no; }'
        with self.assertRaises(Exception):
            self.collect(artifacts, contents, loaded)

    def test_accepts_actual_systemctl_whitespace_before_path_and_argv_semicolons(self):
        artifacts, contents, loaded = fixture()
        for stem in timers.STOPS:
            key = stem + '.service'
            loaded[key]['ExecStart'] = loaded[key]['ExecStart'].replace('; argv[]=', ' ; argv[]=')
            loaded[key]['ExecStart'] = loaded[key]['ExecStart'].replace('; ignore_errors=', ' ; ignore_errors=')
        self.assertEqual(len(self.collect(artifacts, contents, loaded)), 3)

    def test_whitespace_normalization_does_not_accept_ignore_errors_or_new_targets(self):
        for replacement in ('ignore_errors=yes', 'stop --time 15 another-container'):
            artifacts, contents, loaded = fixture()
            key = 'baci-prefunded-replay-deadline.service'
            original = 'ignore_errors=no' if replacement.startswith('ignore') else 'stop --time 15 pvb-staging-replay-prefunded'
            loaded[key]['ExecStart'] = loaded[key]['ExecStart'].replace(original, replacement)
            with self.subTest(replacement=replacement), self.assertRaises(Exception):
                self.collect(artifacts, contents, loaded)


if __name__ == '__main__':
    unittest.main()
