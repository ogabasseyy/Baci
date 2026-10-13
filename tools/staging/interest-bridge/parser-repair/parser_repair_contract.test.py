import hashlib
import importlib.util
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('parser_repair_contract', Path(__file__).with_name('parser_repair_contract.py'))
CONTRACT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTRACT)


class ParserRepairContractTests(unittest.TestCase):
    def setUp(self):
        self.original = b'before\n' + CONTRACT.ORIGINAL_CATEGORY + b'\nafter\n'
        self.repaired = self.original.replace(CONTRACT.ORIGINAL_CATEGORY, CONTRACT.REPAIRED_CATEGORY)
        self.pins = patch.multiple(CONTRACT,
            ORIGINAL_DIGEST=hashlib.sha256(self.original).hexdigest(),
            REPAIRED_DIGEST=hashlib.sha256(self.repaired).hexdigest())
        self.pins.start()
        self.addCleanup(self.pins.stop)

    def metadata(self, **overrides):
        values = dict(st_mode=stat.S_IFREG | 0o644, st_uid=0, st_gid=65532, st_nlink=1, st_size=100)
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_accepts_only_the_exact_one_line_category_repair(self):
        CONTRACT.validate_replacement(self.original, self.repaired)

    def test_refuses_additional_byte_changes_even_with_matching_candidate_pin(self):
        foreign = self.repaired + b'foreign'
        with patch.object(CONTRACT, 'REPAIRED_DIGEST', CONTRACT.digest(foreign)):
            with self.assertRaises(CONTRACT.Refused):
                CONTRACT.validate_replacement(self.original, foreign)

    def test_refuses_multiple_original_category_occurrences(self):
        original = self.original + CONTRACT.ORIGINAL_CATEGORY
        repaired = original.replace(CONTRACT.ORIGINAL_CATEGORY, CONTRACT.REPAIRED_CATEGORY, 1)
        with patch.multiple(CONTRACT, ORIGINAL_DIGEST=CONTRACT.digest(original), REPAIRED_DIGEST=CONTRACT.digest(repaired)):
            with self.assertRaises(CONTRACT.Refused):
                CONTRACT.validate_replacement(original, repaired)

    def test_refuses_foreign_original_bytes(self):
        with self.assertRaises(CONTRACT.Refused):
            CONTRACT.validate_replacement(self.original + b'foreign', self.repaired)

    def test_accepts_original_root_owned_nonexecutable_file_metadata(self):
        CONTRACT.validate_metadata(self.metadata(), 0, 65532, 0o644)

    def test_refuses_symlink_hardlink_owner_group_mode_and_size_drift(self):
        for override in ({'st_mode': stat.S_IFLNK | 0o644}, {'st_nlink': 2},
                {'st_uid': 1001}, {'st_gid': 0}, {'st_mode': stat.S_IFREG | 0o666},
                {'st_mode': stat.S_IFREG | 0o755}, {'st_size': 0}, {'st_size': 16_000_001}):
            with self.subTest(override=override):
                with self.assertRaises(CONTRACT.Refused):
                    CONTRACT.validate_metadata(self.metadata(**override), 0, 65532, 0o644)

    def test_keeps_historical_manifest_and_financial_configuration_pins_fixed(self):
        self.assertEqual(CONTRACT.MANIFEST_DIGEST, 'cf11c95d0724bcc45ac2dd4b0b689322c432ce40c2068d4e18a3a9fbbf734106')
        self.assertEqual(set(CONTRACT.CONFIGURATION_DIGESTS), {'config.json', 'prefunded.json'})
        self.assertEqual(CONTRACT.CONFIGURATION_DIGESTS['config.json'],
            '8b749e91accf23a9c1858793c034713bc3d49970f9079f670cff308b3746a160')
        self.assertEqual(CONTRACT.CONFIGURATION_DIGESTS['prefunded.json'],
            'a2356c72a4dbf7e2651c518dc97652733a2699f9321e7a60b848c771cb92a6f0')


if __name__ == '__main__':
    unittest.main()
