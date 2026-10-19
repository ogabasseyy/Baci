from pathlib import Path
from types import SimpleNamespace
import unittest

from sealed_scheduler import bind_sealed_scheduler


HERE = Path(__file__).resolve().parent
ROOT = Path('/root/baci-financial-owner.2ynkl9kc/bundle-r8/tooling')
PINS = {
    str(ROOT / 'runtime_scheduler.py'): 'a30f2422b100bbf61fd356bc61819a78fedc4c5163cb7fd1a73f52037e864adc',
    str(ROOT / 'treasury_owner_contract.py'): 'ddc7796625f9b421d7c01266e1914607d69e849b3f2da874426492e467a94642',
}


class SealedSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.modules = {name: SimpleNamespace(__file__=str(ROOT / (name + '.py')))
            for name in ('runtime_scheduler', 'treasury_owner_contract')}
        self.context = SimpleNamespace(owner=SimpleNamespace(read=self.read))

    def read(self, path, pin, **kwargs):
        self.calls.append((path, pin, kwargs))
        return (HERE.parent / 'prefunded-card' / Path(path).name).read_bytes()

    def test_binds_only_preloaded_modules_from_the_exact_hash_verified_original_closure(self):
        value = bind_sealed_scheduler(self.context, ROOT / 'runtime_scheduler.py', PINS,
            modules=self.modules)
        self.assertIs(value, self.modules['runtime_scheduler'])
        self.assertEqual(len(self.calls), 4)
        self.assertEqual(set(str(call[0]) for call in self.calls), set(PINS))
        self.assertTrue(all(call[1] == PINS[str(call[0])] for call in self.calls))

    def test_refuses_missing_dependency_instead_of_importing_an_unverified_replacement(self):
        self.modules.pop('treasury_owner_contract')
        with self.assertRaisesRegex(ValueError, '^sealed_scheduler_refused$'):
            bind_sealed_scheduler(self.context, ROOT / 'runtime_scheduler.py', PINS, modules=self.modules)

    def test_refuses_sibling_module_path_and_missing_or_changed_source_pins(self):
        self.modules['runtime_scheduler'].__file__ = '/tmp/runtime_scheduler.py'
        with self.assertRaises(ValueError):
            bind_sealed_scheduler(self.context, ROOT / 'runtime_scheduler.py', PINS, modules=self.modules)
        self.modules['runtime_scheduler'].__file__ = str(ROOT / 'runtime_scheduler.py')
        for pins in ({}, PINS | {'/tmp/extra.py': '1' * 64},
            PINS | {str(ROOT / 'runtime_scheduler.py'): '1' * 64}):
            with self.subTest(pins=pins), self.assertRaises(ValueError):
                bind_sealed_scheduler(self.context, ROOT / 'runtime_scheduler.py', pins, modules=self.modules)

    def test_refuses_source_byte_drift_even_if_a_reader_claims_success(self):
        self.context.owner.read = lambda *args, **kwargs: b'changed'
        with self.assertRaises(ValueError):
            bind_sealed_scheduler(self.context, ROOT / 'runtime_scheduler.py', PINS, modules=self.modules)

    def test_refuses_module_replacement_during_the_final_source_read(self):
        def read(path, pin, **kwargs):
            raw = self.read(path, pin, **kwargs)
            if len(self.calls) == 4:
                self.modules['runtime_scheduler'] = SimpleNamespace(__file__=str(ROOT / 'runtime_scheduler.py'))
            return raw
        self.context.owner.read = read
        with self.assertRaises(ValueError):
            bind_sealed_scheduler(self.context, ROOT / 'runtime_scheduler.py', PINS, modules=self.modules)


if __name__ == '__main__':
    unittest.main()
