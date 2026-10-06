set -eu
pnpm exec python3 -B - <<'PY'
import importlib.util
from pathlib import Path
import sys
import unittest

root = Path('tools/staging/interest-bridge/test-plan').resolve()
sys.path.insert(0, str(root))
suite = unittest.TestSuite()
for path in sorted(root.glob('*.test.py')):
    specification = importlib.util.spec_from_file_location(path.stem.replace('.', '_'), path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
result = unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(not result.wasSuccessful())
PY
