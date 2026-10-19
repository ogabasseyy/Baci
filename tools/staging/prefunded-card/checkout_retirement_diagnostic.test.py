import json
from pathlib import Path
import unittest

from checkout_retirement_diagnostic import failure_diagnostic
from treasury_owner_contract import Refused


class DiagnosticTests(unittest.TestCase):
    def captured(self, filename, failure):
        namespace = {'failure': failure}
        exec(compile('def check():\n    raise failure\n', str(filename), 'exec'), namespace)
        try:
            namespace['check']()
        except Exception as error:
            return error
        self.fail('Expected diagnostic fixture failure')

    def test_identifies_allowlisted_check_without_exception_text_or_source_content(self):
        filename = Path(__file__).with_name('public_app_upgrade_io.py')
        error = self.captured(filename, Refused('credential-canary'))
        self.assertEqual(failure_diagnostic(error), {
            'reasonCode': 'REFUSED_CHECK',
            'sourceModule': 'public_app_upgrade_io.py',
            'sourceLine': 2,
        })
        self.assertNotIn('credential-canary', json.dumps(failure_diagnostic(error)))

    def test_unexpected_exception_is_never_formatted(self):
        class Unprintable(RuntimeError):
            def __str__(self):
                raise AssertionError('Exception text was accessed')

        error = self.captured(Path(__file__).with_name('checkout_retirement_provider.py'),
                              Unprintable('secret-canary'))
        self.assertEqual(failure_diagnostic(error), {
            'reasonCode': 'UNEXPECTED_EXCEPTION',
            'sourceModule': 'checkout_retirement_provider.py',
            'sourceLine': 2,
        })

    def test_foreign_directory_and_unlisted_module_names_are_not_emitted(self):
        for filename in (Path('/private/credential-canary/public_app_upgrade_io.py'),
                         Path(__file__).with_name('secret-canary.py')):
            with self.subTest(filename=filename):
                error = self.captured(filename, RuntimeError('secret-canary'))
                self.assertEqual(failure_diagnostic(error), {
                    'reasonCode': 'UNEXPECTED_EXCEPTION', 'sourceModule': None, 'sourceLine': None,
                })

    def test_deepest_allowlisted_frame_wins_without_following_exception_context(self):
        namespace = {'failure': Refused('secret-inner')}
        exec(compile('def inner():\n    raise failure\n',
                     str(Path(__file__).with_name('public_app_upgrade_io.py')), 'exec'), namespace)
        exec(compile('def outer():\n    inner()\n',
                     str(Path(__file__).with_name('public_app_upgrade.py')), 'exec'), namespace)
        try:
            namespace['outer']()
        except Refused as error:
            error.__context__ = RuntimeError('secret-context')
            result = failure_diagnostic(error)
        self.assertEqual(result['sourceModule'], 'public_app_upgrade_io.py')
        self.assertEqual(result['sourceLine'], 2)
        self.assertNotIn('secret', json.dumps(result))

    def test_unraised_refusal_has_no_source(self):
        self.assertEqual(failure_diagnostic(Refused('private')), {
            'reasonCode': 'REFUSED_CHECK', 'sourceModule': None, 'sourceLine': None,
        })


if __name__ == '__main__':
    unittest.main()
