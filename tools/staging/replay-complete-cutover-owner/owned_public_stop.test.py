import unittest
from unittest.mock import Mock, patch

import public_resume_runtime as subject


class Tests(unittest.TestCase):
    def fixture(self):
        runtime = subject.PublicRuntime()
        runtime.properties = Mock(return_value=dict(FragmentPath=subject.resume.UNIT, DropInPaths='',
            NeedDaemonReload='no', LoadState='loaded', Transient='no'))
        runtime.unit_commands = Mock(return_value={
            'ExecStopPost': [[*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.NAME]]})
        return runtime

    def test_stop_authority_checks_pinned_bytes_effective_unit_and_exact_stop_hook(self):
        runtime = self.fixture()
        with patch.object(subject.resume, '_read', return_value=b'authenticated unit') as protected:
            self.assertTrue(runtime.stop_authority(lambda limit: limit))
        protected.assert_called_once_with(runtime.read, subject.resume.UNIT, subject.resume.UNIT_PIN, 0o644)
        self.assertEqual(runtime.properties.call_args.args[-1], 1)
        self.assertEqual(runtime.unit_commands.call_args.args[1], ('ExecStopPost',))

    def test_changed_unit_profile_or_effective_hook_refuses(self):
        for key, value in (('FragmentPath', '/foreign'), ('DropInPaths', '/foreign.conf'),
                ('NeedDaemonReload', 'yes'), ('LoadState', 'not-found'), ('Transient', 'yes')):
            runtime = self.fixture()
            runtime.properties.return_value[key] = value
            with self.subTest(key=key), patch.object(subject.resume, '_read', return_value=b'authenticated'):
                with self.assertRaises(ValueError):
                    runtime.stop_authority(lambda limit: limit)
                runtime.unit_commands.assert_not_called()
        runtime = self.fixture()
        runtime.unit_commands.return_value = {'ExecStopPost': [['/bin/sh', '-c', 'foreign hook']]}
        with patch.object(subject.resume, '_read', return_value=b'authenticated'), self.assertRaises(ValueError):
            runtime.stop_authority(lambda limit: limit)

    def test_changed_unit_bytes_block_stopunit_hooks_but_allow_exact_docker_withdrawal(self):
        runtime = subject.PublicRuntime()
        runtime.attempted = True
        runtime.jobs = Mock(side_effect=TimeoutError('inspection failure'))
        runtime.command = Mock(return_value='')
        with patch.object(subject.resume, '_read', side_effect=ValueError('unit hash drift')):
            with self.assertRaises(ValueError):
                runtime.run([*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID], timeout=15)
        runtime.command.assert_called_once()
        self.assertEqual(runtime.command.call_args.args[0],
            [*subject.resume.DOCKER, 'stop', '--time', '5', subject.resume.CID])
        self.assertFalse(runtime.cleanup_confirmed)


if __name__ == '__main__':
    unittest.main()
