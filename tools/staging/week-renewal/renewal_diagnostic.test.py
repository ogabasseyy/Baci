import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import renewal_contract as contract
import renewal_diagnostic as diagnostic
import renewal_io as secure_io


class DiagnosticTests(unittest.TestCase):
    def test_known_refusal_is_named_without_exception_text(self):
        result = diagnostic.failure_diagnostic(contract.Refused('source-pin'))
        self.assertEqual(result['reasonCode'], 'source-pin')
        self.assertNotIn('message', result)

    def test_unknown_refusal_and_exception_cannot_print_secrets(self):
        for error in (contract.Refused('private-secret'), RuntimeError('private-secret'),
                      OSError(13, 'private-secret', '/private-secret')):
            result = diagnostic.failure_diagnostic(error)
            self.assertNotIn('private-secret', json.dumps(result))
            self.assertIsNone(result['sourceModule'])
            self.assertIsNone(result['sourceLine'])

    def test_real_failed_input_hash_reports_trusted_path_and_line_not_contents(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'secret.env'
            path.write_bytes(b'private-secret')
            path.chmod(0o600)
            with patch.object(diagnostic, 'PINS', {str(path): '0' * 64}), \
                    patch.object(secure_io, 'trusted_parents'):
                try:
                    secure_io.read_verified(path, (0o600,), (-1,), owner=path.stat().st_uid)
                except contract.Refused as error:
                    result = diagnostic.failure_diagnostic(error)
        self.assertEqual(result['reasonCode'], 'source-metadata')
        self.assertEqual(result['sourceModule'], 'renewal_io.py')
        self.assertGreater(result['sourceLine'], 0)
        self.assertEqual(result['failedInput'], str(path))
        self.assertEqual(result['inputMetadata']['mode'], '0600')
        self.assertNotIn('private-secret', json.dumps(result))

    def test_unreviewed_path_and_unrelated_traceback_are_not_exposed(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'private-secret'
            path.write_bytes(b'private-secret')
            path.chmod(0o600)
            with patch.object(secure_io, 'trusted_parents'):
                try:
                    secure_io.read_verified(path, (0o400,), (-1,), owner=path.stat().st_uid)
                except contract.Refused as error:
                    result = diagnostic.failure_diagnostic(error)
        self.assertNotIn('failedInput', result)
        self.assertNotIn('inputMetadata', result)
        self.assertNotIn('private-secret', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
