"""Temporarily isolate authenticated legacy imports from the outer source closure."""

from contextlib import contextmanager
import hashlib
import sys
from pathlib import Path

from continuation_release import decode, protected_bytes, require


ROOT = Path('/root/baci-existing-projection-source.btzzmjl9')
SEAL = 'f9d2fcb4caf7481ebe8c0720a0cceb572bd1557c2e83f7f6c17a33d4560286ed'
SHARED = frozenset(('cutover_runtime', 'financial_completion', 'financial_delta',
    'completion_snapshot', 'application_reports'))
SOURCE_MAPPING = {
    'cutover_runtime': ('4c53a707d6c683e5ea24a2df8cd68647b504efb21e3313a4d97661576047358a',
        '4c53a707d6c683e5ea24a2df8cd68647b504efb21e3313a4d97661576047358a'),
    'financial_completion': ('a8411a6fbe9d3c7029b99357f2c4c13cf5c1b99979adb2ad0bbbceff27fb88d1',
        '75e27c0113fd39ceea8c4d8957bea83a8abf6b543e24432fa9ecd418ef9ff0cd'),
    'financial_delta': ('934ca43a3ad872933fcb04e9ec162828b5469f9408d4fce3c53ceddb0206d7b2',
        '934ca43a3ad872933fcb04e9ec162828b5469f9408d4fce3c53ceddb0206d7b2'),
    'completion_snapshot': ('8632ef5365c894da47d1da9c35d20a3bc7e747003bb5f192dc5140ed6ac156d4',
        '76c54d8083df9ec5e52c3b2dad391a6a31f2da4bc57d1e2c54c826f4fa7fbb77'),
    'application_reports': ('85b8e7a5d3fea0b0fc48272ac9494727e9475d960aba5d2e2022ef0b9416d0b5',
        'c2b66c18f9b7bd1d33e4205165347f2111fff79a3a9377a69edd4d7ba8c067e4'),
}


def verify_mapping(original, outer):
    require(all(hashlib.sha256(original[name+'.py']).hexdigest() == pins[0]
        and hashlib.sha256(outer[name+'.py']).hexdigest() == pins[1]
        for name, pins in SOURCE_MAPPING.items()))


def capture(diagnostic):
    raw = protected_bytes(ROOT/'release.json', SEAL)
    manifest = decode(raw)
    require(type(manifest) is dict and set(manifest) == {'kind', 'files'}
        and manifest['kind'] == 'financial-project-existing-verified-transfer-only')
    captured = diagnostic.authenticate_root()
    require(set(captured) == set(manifest['files']) and len(captured) == 39
        and all(hashlib.sha256(source).hexdigest() == manifest['files'][name]
            for name, source in captured.items()))
    return captured


class Legacy:
    def __init__(self, diagnostic, captured):
        self.diagnostic, self.captured = diagnostic, captured
        self.names = {name[:-3] for name in captured if name.endswith('.py')}
        self.modules, self.active = {}, False
        self.outer = {name: sys.modules[name] for name in self.names if name in sys.modules}
        directory = Path(__file__).parent
        require(set(self.outer) <= SHARED and all(getattr(value, '__file__', None)
            == str(directory/(name+'.py')) for name, value in self.outer.items()))

    @contextmanager
    def scope(self):
        require(not self.active and all(sys.modules.get(name) is value
            for name, value in self.outer.items()))
        require(all(name in self.outer or name not in sys.modules for name in self.names))
        require(all(name not in sys.modules for name in set(self.modules)-self.names))
        self.active = True
        previous, path, finders = dict(sys.modules), list(sys.path), list(sys.meta_path)
        bytecode = sys.dont_write_bytecode
        try:
            for name in self.names:
                sys.modules.pop(name, None)
            sys.modules.update(self.modules)
            owner, readiness, finder = self.diagnostic.bootstrap(self.captured) if not self.modules else (
                self.modules['projection_owner'], self.modules['financial_readiness_owner'], self.finder)
            self.finder = finder
            if finder not in sys.meta_path:
                sys.meta_path.insert(0, finder)
            pins, authenticated = owner._closure(ROOT, SEAL)
            require(authenticated == self.captured)
            loaded = readiness._load_modules(ROOT)
            for name in (*sorted(SHARED), 'financial_readiness_owner',
                'projection_preflight', 'financial_reconcile_pass'):
                loaded[name] = __import__(name)
                require(loaded[name] is sys.modules[name]
                    and loaded[name].__file__ == str(ROOT/(name+'.py')))
            readiness._canonical(authenticated, loaded['natural_reclaim_authority'])
            self.pins, self.loaded = pins, loaded
            yield loaded
        finally:
            added = {name: value for name, value in sys.modules.items() if name in self.names
                or (name not in previous and str(getattr(value, '__file__', '')).startswith('/root/'))}
            self.modules.update(added)
            for name in added:
                sys.modules.pop(name, None)
            for name in self.names | set(added):
                if name in previous:
                    sys.modules[name] = previous[name]
            sys.path[:] = path
            sys.meta_path[:] = finders
            sys.dont_write_bytecode = bytecode
            self.active = False

    def recheck(self):
        require(capture(self.diagnostic) == self.captured)
