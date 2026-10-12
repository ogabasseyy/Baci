import hashlib
import json
import re
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
WRAPPER = ROOT / 'renew-seven-day-owner-root.sh'
RUNTIME_NAMES = (
    'managed-gateway-cli.mjs',
    'managed-gateway.mjs',
    'managed-files.mjs',
    'managed-inventory-helper.mjs',
    'private-routing.mjs',
    'private-routing-inventory.mjs',
    'private-routing-supervisor-inventory.mjs',
    'private-routing-supervisor-child.py',
    'compose.mjs',
)


def embedded_python_blocks():
    source = WRAPPER.read_text()
    return re.findall(r"/usr/bin/python3 .*?<<'PY'.*?\n(.*?)\nPY", source, re.DOTALL)


def run_python_block(block, *arguments):
    return subprocess.run(
        ['python3', '-I', '-c', block, *map(str, arguments)],
        check=False,
        capture_output=True,
        text=True,
    )


class RenewalPythonBlockTests(unittest.TestCase):
    def test_predecessor_accepts_only_installed_runtime_and_service_files(self):
        predecessor = embedded_python_blocks()[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = root / 'managed-install-manifest.json'
            receipt_path = root / 'receipt.json'
            code_path = root / 'code'
            code_path.mkdir()
            gateway_unit = root / 'gateway.service'
            sudoers_path = root / 'sudoers' / 'baci-savings-gateway'
            sudoers_path.parent.mkdir()

            contents = {name: ('installed:' + name).encode() for name in RUNTIME_NAMES}
            contents.update({name: ('manifest-only:' + name).encode() for name in (
                'install-managed-gateway.py',
                'managed-install-policy.py',
                'managed-install-transaction.py',
            )})
            contents['managed-gateway.service'] = b'[Unit]\nDescription=installed\n'
            contents['managed-gateway.sudoers'] = b'User_Alias BACI=\n'
            for name, content in contents.items():
                target = code_path / ('baci-savings-gateway.service' if name == 'managed-gateway.service' else name)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            gateway_unit.write_bytes(contents['managed-gateway.service'])
            sudoers_path.write_bytes(contents['managed-gateway.sudoers'])

            manifest = {
                'version': 1,
                'files': {name: hashlib.sha256(content).hexdigest() for name, content in contents.items()},
            }
            manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
            receipt_path.write_text(json.dumps({'manifestSha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest()}))
            block = predecessor.replace(
                "pathlib.Path('/etc/sudoers.d/baci-savings-gateway')",
                "pathlib.Path(" + repr(str(sudoers_path)) + ")",
            )

            result = run_python_block(block, manifest_path, receipt_path, code_path, gateway_unit)

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_predecessor_refuses_manifest_digest_mismatch(self):
        predecessor = embedded_python_blocks()[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = root / 'managed-install-manifest.json'
            receipt_path = root / 'receipt.json'
            code_path = root / 'code'
            code_path.mkdir()
            gateway_unit = root / 'gateway.service'
            manifest_path.write_text('{"version": 1, "files": {}}')
            receipt_path.write_text(json.dumps({'manifestSha256': '0' * 64}))

            result = run_python_block(predecessor, manifest_path, receipt_path, code_path, gateway_unit)

        self.assertNotEqual(result.returncode, 0)

    def test_expiry_block_replaces_exact_draft_and_smoke_conditions_and_timer(self):
        renewal = embedded_python_blocks()[3].replace(
            'from datetime import UTC, datetime',
            'from datetime import timezone, datetime\nUTC = timezone.utc',
        )
        expiry = 1_790_000_000
        expiry_text = str(expiry)
        condition = "ExecCondition=/bin/sh -c '[ \"$(/bin/date -u +%%s)\" -lt 1789989845 ]'\n"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            draft_path = root / 'draft.service'
            smoke_path = root / 'smoke.service'
            timer_path = root / 'deadline.timer'
            draft_path.write_text('PORT=4792\n' + condition + 'RuntimeMaxSec=1d\n')
            smoke_path.write_text('PORT=4794\n' + condition + 'RuntimeMaxSec=120\n')
            timer_path.write_text('OnCalendar=2026-09-21 11:24:05 UTC\n')

            result = run_python_block(renewal, draft_path, smoke_path, timer_path, expiry_text)
            draft = draft_path.read_text()
            smoke = smoke_path.read_text()
            timer = timer_path.read_text()

        expected_condition = condition.replace('1789989845', expiry_text)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(expected_condition, draft)
        self.assertIn(expected_condition, smoke)
        self.assertIn('RuntimeMaxSec=7d\n', draft)
        self.assertIn('RuntimeMaxSec=120\n', smoke)
        self.assertEqual(timer, 'OnCalendar=' + datetime.fromtimestamp(expiry, timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC') + '\n')

    def test_expiry_block_refuses_mismatched_draft_condition_without_mutation(self):
        renewal = embedded_python_blocks()[3].replace(
            'from datetime import UTC, datetime',
            'from datetime import timezone, datetime\nUTC = timezone.utc',
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [root / name for name in ('draft.service', 'smoke.service', 'deadline.timer')]
            paths[0].write_text("ExecCondition=/bin/sh -c '[ \"$(/bin/date -u +%%s)\" -lt 123 ]'\nRuntimeMaxSec=1d\n")
            paths[1].write_text("ExecCondition=/bin/sh -c '[ \"$(/bin/date -u +%%s)\" -lt 1789989845 ]'\nRuntimeMaxSec=120\n")
            paths[2].write_text('OnCalendar=2026-09-21 11:24:05 UTC\n')
            before = [path.read_bytes() for path in paths]

            result = run_python_block(renewal, *paths, 1_790_000_000)

            after = [path.read_bytes() for path in paths]

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(after, before)


class RollbackShellTests(unittest.TestCase):
    def test_rollback_restores_archived_files_and_quarantines_fresh_evidence(self):
        source = WRAPPER.read_text()
        rollback = source[source.index('rollback() {'):source.index('trap rollback EXIT')]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code = root / 'code'
            config = root / 'config'
            archive = root / 'archive'
            backup = archive / 'original'
            failed = archive / 'failed-fresh'
            systemd = root / 'systemd'
            log_path = root / 'systemctl.log'
            for path in (code, config, backup, systemd):
                path.mkdir(parents=True)
            for name in ('binding.json', 'startup-evidence.json'):
                (archive / name).write_text('archived-' + name)
                (config / name).write_text('fresh-' + name)
            (backup / 'managed-gateway.mjs').write_text('old-gateway')
            (code / 'managed-gateway.mjs').write_text('fresh-gateway')
            for name in ('managed-private-smoke-runner.mjs', 'managed-hosted-draft-renewal-runner.mjs', 'managed-hosted-draft-identity.json'):
                (code / name).write_text('fresh')
            for name in ('baci-savings-gateway.service', 'baci-savings-drafts.service', 'baci-savings-drafts-smoke.service', 'baci-savings-drafts-deadline.timer'):
                (backup / name).write_text('old-' + name)

            transformed = rollback.replace('/usr/bin/systemctl', '/usr/bin/true')
            transformed = transformed.replace('/usr/bin/install -d -o root -g root -m 0700 "$failed"', 'mkdir -p "$failed"')
            transformed = transformed.replace('cp --preserve=all ', 'cp -p ')
            transformed = transformed.replace('/usr/bin/cp', '/bin/cp').replace('/usr/bin/mv', '/bin/mv').replace('/usr/bin/rm', '/bin/rm')
            transformed = transformed.replace('"/etc/systemd/system/$name"', '"' + str(systemd) + '/$name"')
            script = f'''\nset +e\ncode={code!s}\nconfig={config!s}\narchive={archive!s}\nbackup={backup!s}\nfailed={failed!s}\nfresh_started=true\nSYSTEMCTL_LOG={log_path!s}\nexport SYSTEMCTL_LOG\nlog() {{ printf '{{"stage":"%s","status":"%s"}}\\n' "$1" "$2"; }}\nquiet() {{ "$@" >/dev/null 2>&1; }}\n{transformed}\nfalse\nrollback\n'''
            result = subprocess.run(['sh', '-c', script], check=False, capture_output=True, text=True)

            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual((config / 'binding.json').read_text(), 'archived-binding.json')
            self.assertEqual((config / 'startup-evidence.json').read_text(), 'archived-startup-evidence.json')
            self.assertEqual((failed / 'binding.json').read_text(), 'fresh-binding.json')
            self.assertEqual((failed / 'startup-evidence.json').read_text(), 'fresh-startup-evidence.json')
            self.assertEqual((code / 'managed-gateway.mjs').read_text(), 'old-gateway')
            self.assertFalse((code / 'managed-private-smoke-runner.mjs').exists())
            self.assertFalse((code / 'managed-hosted-draft-renewal-runner.mjs').exists())
            self.assertFalse((code / 'managed-hosted-draft-identity.json').exists())
            self.assertEqual((systemd / 'baci-savings-drafts-deadline.timer').read_text(), 'old-baci-savings-drafts-deadline.timer')

    def test_rollback_does_not_restore_when_stop_fails(self):
        source = WRAPPER.read_text()
        rollback = source[source.index('rollback() {'):source.index('trap rollback EXIT')]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code = root / 'code'
            config = root / 'config'
            archive = root / 'archive'
            backup = archive / 'original'
            failed = archive / 'failed-fresh'
            systemd = root / 'systemd'
            for path in (code, config, backup, systemd):
                path.mkdir(parents=True)
            (archive / 'binding.json').write_text('archived')
            (config / 'binding.json').write_text('fresh')
            (backup / 'managed-gateway.mjs').write_text('old-gateway')
            (code / 'managed-gateway.mjs').write_text('fresh-gateway')
            transformed = rollback.replace('/usr/bin/systemctl', '/usr/bin/false')
            transformed = transformed.replace('/usr/bin/install -d -o root -g root -m 0700 "$failed"', 'mkdir -p "$failed"')
            transformed = transformed.replace('"/etc/systemd/system/$name"', '"' + str(systemd) + '/$name"')
            script = f'''\nset +e\ncode={code!s}\nconfig={config!s}\narchive={archive!s}\nbackup={backup!s}\nfailed={failed!s}\nfresh_started=true\nlog() {{ printf '{{"stage":"%s","status":"%s"}}\\n' "$1" "$2"; }}\nquiet() {{ "$@" >/dev/null 2>&1; }}\n{transformed}\nfalse\nrollback\n'''
            result = subprocess.run(['sh', '-c', script], check=False, capture_output=True, text=True)

            self.assertEqual(result.returncode, 1)
            self.assertIn('"stage":"rollback-stop","status":"failed"', result.stderr)
            self.assertEqual((config / 'binding.json').read_text(), 'fresh')
            self.assertEqual((code / 'managed-gateway.mjs').read_text(), 'fresh-gateway')
            self.assertFalse(failed.exists())


if __name__ == '__main__':
    unittest.main()
