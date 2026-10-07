import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('foundation-install-reviewed.sh')


class FoundationLauncherTests(unittest.TestCase):
    def test_help_does_not_connect_or_require_bundle(self):
        result = subprocess.run(['/bin/bash', str(SCRIPT), '--help'], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(b'No payment activation', result.stdout)

    def test_missing_or_changed_local_bundle_never_connects(self):
        self.run_fixture(tamper=True)

    def test_root_command_preserves_checksums_and_argument_boundaries(self):
        self.run_fixture(tamper=False)

    def test_mutation_after_local_check_cannot_change_the_root_sql_pin(self):
        self.run_fixture(tamper=False, mutate_after_check=True)

    def run_fixture(self, tamper, mutate_after_check=False):
        with tempfile.TemporaryDirectory(prefix='baci-foundation-test.') as temporary:
            directory = Path(temporary)
            manifest = ''
            for name in ['foundation.sql', 'foundation-owner.py']:
                content = f'synthetic {name}\n'.encode()
                (directory / name).write_bytes(content)
                manifest += f'{hashlib.sha256(content).hexdigest()}  {name}\n'
            (directory / 'foundation-bundle.SHA256SUMS').write_text(manifest)
            expected = hashlib.sha256(manifest.encode()).hexdigest()
            script = re.sub(r"EXPECTED_BUNDLE='[^']+'", f"EXPECTED_BUNDLE='{expected}'",
                            SCRIPT.read_text())
            selected = directory / SCRIPT.name
            selected.write_text(script)
            if tamper:
                (directory / 'foundation.sql').write_text('changed SQL')
            binaries = directory / 'bin'
            binaries.mkdir()
            log = directory / 'calls'
            mock = '''#!/usr/bin/env python3
import os,sys
from pathlib import Path
with open(os.environ['MOCK_LOG'],'a') as handle:
    handle.write(Path(sys.argv[0]).name+'\\n')
if Path(sys.argv[0]).name=='scp':
    assert len(sys.argv)==4, sys.argv
elif sys.argv[1]=='-o':
    sys.stdin.read()
    print('/tmp/baci-prefunded-foundation.12345678')
else:
    assert sys.argv[1:5]==['-tt','-o','ServerAliveInterval=15','bassey@82.29.190.219']
    assert len(sys.argv)==6, sys.argv
    assert os.environ['EXPECTED_SQL_PIN'] in sys.argv[5]
    import subprocess
    probe = ''' + repr('''set -euo pipefail
eval "set -- $1"
[[ $# -eq 4 && "$1" == /usr/bin/env && "$2" == bash && "$3" == -c ]]
[[ "$4" == *sudo* && "$4" == *"sha256sum -c -"*python3* ]]
[[ "$4" != *foundation-bundle.SHA256SUMS* ]]
/bin/bash -n <<< "$4"
''') + '''
    subprocess.run(['/bin/bash','-c',probe,'probe',sys.argv[5]],check=True)
'''
            for name in ['ssh', 'scp']:
                (binaries / name).write_text(mock)
                (binaries / name).chmod(0o700)
            if mutate_after_check:
                (binaries / 'shasum').write_text('''#!/usr/bin/env python3
import subprocess,sys
from pathlib import Path
contents=sys.stdin.read() if '-c' in sys.argv and sys.argv[-1]=='-' else None
result=subprocess.run(['/usr/bin/shasum',*sys.argv[1:]],input=contents,text=True)
if '-c' in sys.argv and result.returncode==0:
    if sys.argv[-1]=='foundation-bundle.SHA256SUMS' or '  foundation.sql' in (contents or ''):
        Path('foundation.sql').write_text('changed after local check')
raise SystemExit(result.returncode)
''')
                (binaries / 'shasum').chmod(0o700)
            environment = os.environ | {'MOCK_LOG': str(log),
                                        'EXPECTED_SQL_PIN': hashlib.sha256(b'synthetic foundation.sql\n').hexdigest(),
                                        'PATH': f'{binaries}:{os.environ["PATH"]}'}
            result = subprocess.run(['/bin/bash', str(selected)], env=environment,
                                    capture_output=True, text=True)
            if tamper:
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(log.exists())
            else:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(log.read_text().splitlines(), ['ssh', 'scp', 'ssh'])


if __name__ == '__main__':
    unittest.main()
