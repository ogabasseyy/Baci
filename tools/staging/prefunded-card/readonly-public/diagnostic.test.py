import importlib.util
import json
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location('readonly_diagnostic', Path(__file__).with_name('diagnostic.py'))
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


class DiagnosticTests(unittest.TestCase):
    def test_report_excludes_exception_content_and_frame_locals(self):
        try:
            raise RuntimeError('private-provider-body-and-secret')
        except Exception as error:
            report = diagnostic.failure_report(error)
        self.assertNotIn('private-provider-body-and-secret', json.dumps(report))
        self.assertTrue(report['readOnly'])
        self.assertFalse(report['databaseApplied'])
        self.assertEqual(set(report['frames'][0]), {'module', 'line'})


if __name__ == '__main__':
    unittest.main()
