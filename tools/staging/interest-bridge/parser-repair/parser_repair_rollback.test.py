import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('parser_repair_owner_tests',
    Path(__file__).with_name('parser_repair_owner.test.py'))
FIXTURES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURES)
OWNER = FIXTURES.OWNER


class ParserRepairRollbackTests(unittest.TestCase):
    def test_restores_originals_when_removal_commits_before_its_reply_times_out(self):
        repair = FIXTURES.FakeRepair()
        baseline = copy.deepcopy(repair.containers)
        repair.run()
        command = repair.command
        ambiguous = True

        def remove_then_timeout(arguments):
            nonlocal ambiguous
            result = command(arguments)
            if arguments[len(OWNER.DOCKER)] == 'rm' and ambiguous:
                ambiguous = False
                raise TimeoutError('Simulated ambiguous removal')
            return result

        with patch.object(repair, 'command', side_effect=remove_then_timeout):
            repair.rollback()

        self.assertEqual(repair.containers, baseline)
        self.assertEqual(repair.daemon, OWNER.ORIGINAL_DIGEST)

    def test_resumes_rollback_after_one_candidate_was_already_removed(self):
        repair = FIXTURES.FakeRepair()
        baseline = copy.deepcopy(repair.containers)
        repair.run()
        identifier = next(reversed(repair.created.values()))
        repair.command([*OWNER.DOCKER, 'rm', identifier])

        repair.rollback()
        repair.rollback()

        self.assertEqual(repair.containers, baseline)
        self.assertEqual(repair.daemon, OWNER.ORIGINAL_DIGEST)
        self.assertTrue(all('--no-trunc' in command for command in repair.commands
            if command[0] == 'ps' and any(value.startswith('id=') for value in command)))

    def test_refuses_cleanup_when_failed_removal_leaves_the_candidate_present(self):
        repair = FIXTURES.FakeRepair()
        repair.run()
        baseline = copy.deepcopy(repair.containers)
        command = repair.command

        def refuse_removal(arguments):
            if arguments[len(OWNER.DOCKER)] == 'rm':
                raise OWNER.Refused('Simulated removal refusal')
            return command(arguments)

        with patch.object(repair, 'command', side_effect=refuse_removal):
            with self.assertRaises(OWNER.Refused):
                repair.rollback()

        self.assertEqual(repair.containers, baseline)
        self.assertEqual(repair.daemon, OWNER.REPAIRED_DIGEST)


if __name__ == '__main__':
    unittest.main()
