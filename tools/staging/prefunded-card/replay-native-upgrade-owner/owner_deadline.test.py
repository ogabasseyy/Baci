from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).parent))
from owner_io import Refused
from owner_deadline import DATE, EPOCH, STEM, STOPPER, TIMER, verify_deadline


class DeadlineTest(unittest.TestCase):
    def fixture(self):
        units = {STEM + '.timer': TIMER, STEM + '.service': STOPPER}
        properties = {}
        for suffix in ('.timer', '.service'):
            name = STEM + suffix
            values = {'FragmentPath': '/etc/systemd/system/' + name, 'DropInPaths': '', 'NeedDaemonReload': 'no'}
            if suffix == '.timer':
                values.update(ActiveState='active', Unit=STEM + '.service',
                              TimersCalendar='{ OnCalendar=' + DATE + ' ; next_elapse=Tue ' + DATE + ' }',
                              NextElapseUSecRealtime='Tue ' + DATE)
            else:
                values['ExecStart'] = '{ path=/usr/bin/docker ; argv[]=/usr/bin/docker --host=unix:///var/run/docker.sock stop --time 15 pvb-staging-replay-prefunded ; ignore_errors=no ; }'
            properties[name] = values
        reader = lambda filename, **options: units[filename.name]
        run = lambda arguments: '\n'.join(key + '=' + value for key, value in properties[arguments[2]].items())
        return units, properties, reader, run

    def test_preserves_loaded_oct6_stop_original_name_contract(self):
        units, properties, reader, run = self.fixture()
        verify_deadline(run, reader, lambda: EPOCH - 600)

    def test_refuses_expiry_unit_edits_dropins_wrong_stop_and_calendar(self):
        for change in ('expired', 'bytes', 'dropin', 'stop', 'calendar', 'inactive'):
            units, properties, reader, run = self.fixture()
            if change == 'bytes':
                units[STEM + '.timer'] = TIMER.replace(b'2026-10-06', b'2026-10-07')
            if change == 'dropin':
                properties[STEM + '.service']['DropInPaths'] = '/etc/systemd/system/unreviewed.conf'
            if change == 'stop':
                properties[STEM + '.service']['ExecStart'] = properties[STEM + '.service']['ExecStart'].replace('pvb-staging-replay-prefunded', 'unrelated')
            if change == 'calendar':
                properties[STEM + '.timer']['TimersCalendar'] += ' { OnCalendar=2026-10-07 00:00:00 UTC }'
            if change == 'inactive':
                properties[STEM + '.timer']['ActiveState'] = 'inactive'
            with self.assertRaises(Refused, msg=change):
                verify_deadline(run, reader, lambda: EPOCH if change == 'expired' else EPOCH - 600, require_active=True)

    def test_paused_timer_is_permitted_only_for_non_starting_preparation(self):
        units, properties, reader, run = self.fixture()
        properties[STEM + '.timer']['ActiveState'] = 'inactive'
        properties[STEM + '.timer']['NextElapseUSecRealtime'] = ''
        verify_deadline(run, reader, lambda: EPOCH - 600)
        with self.assertRaises(Refused):
            verify_deadline(run, reader, lambda: EPOCH - 600, require_active=True)

    def test_refuses_expiry_during_effective_unit_probes(self):
        units, properties, reader, run = self.fixture()
        clock = {'now': EPOCH - 1}
        def blocking_probe(arguments):
            output = run(arguments)
            if arguments[2] == STEM + '.service':
                clock['now'] = EPOCH
            return output
        with self.assertRaisesRegex(Refused, '^fixed_deadline_expired$'):
            verify_deadline(blocking_probe, reader, lambda: clock['now'], require_active=True)


if __name__ == '__main__':
    unittest.main()
