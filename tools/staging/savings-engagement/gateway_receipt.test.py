import tempfile
import unittest
from pathlib import Path

from gateway_receipt import publish_exclusive


class GatewayReceiptPublicationTests(unittest.TestCase):
    def test_publishes_real_file_with_requested_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'receipt.json'
            publish_exclusive(path, b'complete receipt', 0o400)
            self.assertEqual(path.read_bytes(), b'complete receipt')
            self.assertEqual(path.stat().st_mode & 0o777, 0o400)
            self.assertEqual(list(path.parent.iterdir()), [path])

    def test_existing_foreign_receipt_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'receipt.json'
            path.write_bytes(b'foreign receipt')
            with self.assertRaises(FileExistsError):
                publish_exclusive(path, b'new receipt', 0o400)
            self.assertEqual(path.read_bytes(), b'foreign receipt')
            self.assertEqual(list(path.parent.iterdir()), [path])


if __name__ == '__main__':
    unittest.main()
