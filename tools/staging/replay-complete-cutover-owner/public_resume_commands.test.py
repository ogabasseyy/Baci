import copy
import json
import unittest
from unittest.mock import Mock

import public_resume_runtime as subject


CONDITION = ['/bin/sh', '-c', 'test "$(/bin/date -u +%s)" -lt "1791302350"']


def command_value(arguments):
    return dict(type='a(sasbttttuii)', data=[
        [argv[0], argv, False, 0, 0, 0, 0, 0, 0, 0] for argv in arguments])


class Tests(unittest.TestCase):
    def test_actual_execcondition_preserves_shell_expression_as_one_third_argument(self):
        runtime = subject.PublicRuntime()
        path = '/org/freedesktop/systemd1/unit/baci_2dprefunded_2dpublic_2eservice'
        runtime.command = Mock(side_effect=[json.dumps(dict(type='o', data=[path])),
            json.dumps(command_value([CONDITION]))])
        self.assertEqual(runtime.unit_commands(subject.resume.SERVICE, ('ExecCondition',)),
            {'ExecCondition': [CONDITION]})
        self.assertEqual(runtime.command.call_args.args[0][-1], 'ExecCondition')

    def test_structured_signature_cardinality_executable_ignore_errors_and_types_refuse(self):
        baseline = command_value([CONDITION])
        cases = []
        for key, value in (('type', 'foreign'), ('data', []), ('data', baseline['data'] * 2)):
            cases.append(dict(baseline, **{key: value}))
        for index, value in ((0, '/foreign'), (1, ['/bin/sh', True]), (2, True),
                (2, 0), (3, True), (4, -1), (7, 2**32), (8, 2**31)):
            changed = copy.deepcopy(baseline)
            changed['data'][0][index] = value
            cases.append(changed)
        for value in cases:
            with self.subTest(value=value), self.assertRaises(ValueError):
                subject.PublicRuntime().commands(value, 1)

    def test_loadunit_must_be_exact_single_unit_objectpath(self):
        for data in ('/foreign', ['/foreign'], [], ['/foreign', '/another']):
            runtime = subject.PublicRuntime()
            runtime.command = Mock(return_value=json.dumps(dict(type='o', data=data)))
            with self.subTest(data=data), self.assertRaises(ValueError):
                runtime.unit_commands(subject.resume.SERVICE, ('ExecCondition',))
            self.assertEqual(runtime.command.call_count, 1)

    def test_unloaded_stopped_unit_uses_loadunit_metadata_only_without_getunit_or_start(self):
        runtime = subject.PublicRuntime()
        expected = '/org/freedesktop/systemd1/unit/baci_2dprefunded_2dpublic_2eservice'
        def observed(arguments, timeout=10):
            if 'GetUnit' in arguments:
                raise ValueError('Unit baci-prefunded-public.service not loaded')
            if 'LoadUnit' in arguments:
                self.assertEqual(arguments[-3:], ['LoadUnit', 's', subject.resume.SERVICE])
                return json.dumps(dict(type='o', data=[expected]))
            self.assertEqual(arguments, [*subject.BUS, 'get-property', subject.MANAGER[0], expected,
                'org.freedesktop.systemd1.Service', 'ExecCondition'])
            return json.dumps(command_value([CONDITION]))
        runtime.command = Mock(side_effect=observed)
        self.assertEqual(runtime.unit_commands(subject.resume.SERVICE, ('ExecCondition',)),
            {'ExecCondition': [CONDITION]})
        self.assertEqual(runtime.command.call_count, 2)
        self.assertFalse(runtime.attempted)
        with self.assertRaises(ValueError):
            runtime.unit_commands('foreign.service', ('ExecCondition',))
        self.assertEqual(runtime.command.call_count, 2)


if __name__ == '__main__':
    unittest.main()
