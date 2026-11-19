"""Staging-only receiver launcher. Keychain secrets never enter arguments or files."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shlex
import subprocess
import sys

SERVICE = 'baci.oxygen.staging.callback'
ACCOUNT = 'staging-partner'
BASE = Path(__file__).resolve().parent


def read_callback():
    result = subprocess.run(['/usr/bin/security', 'find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], capture_output=True, text=True, check=False)
    if result.returncode == 44:
        return None
    if result.returncode:
        raise ValueError('Keychain unavailable')
    return json.loads(result.stdout)


def main():
    if sys.platform != 'darwin':
        raise ValueError('macOS Keychain required')
    spec = importlib.util.spec_from_file_location('oxygen_keys', BASE.parent / 'oxygen-webhook-observer/staging_keys.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    saved = module.load()
    binding = hashlib.sha256(saved['reference'].encode()).hexdigest()
    checkpoint = json.loads((Path.home() / '.local/state/baci-oxygen/manual-test/staging.json').read_text())
    if checkpoint.get('environment') != 'staging' or checkpoint.get('partnerBinding') != binding:
        raise ValueError('Staging binding mismatch')
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    callback = read_callback()
    if mode == 'setup' and callback is None:
        callback = {'environment': 'staging', 'binding': binding, 'apiKey': secrets.token_hex(32), 'apiSecret': secrets.token_hex(32)}
        command = ' '.join(shlex.quote(v) for v in ['add-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w', json.dumps(callback)]) + '\n'
        result = subprocess.run(['/usr/bin/security', '-i'], input=command, capture_output=True, text=True, check=False)
        if result.returncode or read_callback() != callback:
            raise ValueError('Keychain save unconfirmed')
    if not isinstance(callback, dict) or callback.get('environment') != 'staging' or callback.get('binding') != binding:
        raise ValueError('Callback unavailable')
    for field in ['apiKey', 'apiSecret']:
        if not isinstance(callback.get(field), str) or len(callback[field]) != 64 or any(c not in '0123456789abcdef' for c in callback[field]):
            raise ValueError('Invalid callback credentials')
    if mode == 'setup':
        print('Staging callback credentials verified in Keychain.')
        return
    environment = os.environ.copy()
    environment.update({'NODE_OPTIONS': '--conditions=react-server', 'OXYGEN_TEST_REFERENCE': saved['reference'], 'OXYGEN_CALLBACK_KEY': callback['apiKey'], 'OXYGEN_CALLBACK_SECRET': callback['apiSecret'], 'OXYGEN_CALLBACK_BINDING': binding})
    command = ['pnpm', '--filter', '@baci/web', 'exec', 'tsx']
    if mode in ('serve', 'summary'):
        command += ['tools/oxygen-staging-webhook/cli.ts']
        if mode == 'summary':
            command.append('--summary')
    elif mode == 'register' and len(sys.argv) == 3:
        environment['OXYGEN_TEST_SECRET'] = saved['secret']
        command += ['tools/oxygen-staging-webhook/register-cli.ts', sys.argv[2]]
    else:
        raise ValueError('Use setup, serve, summary, or register CALLBACK_URL')
    os.chdir(BASE.parents[3])
    os.execvpe(command[0], command, environment)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError):
        print('Staging receiver setup failed; check Keychain and checkpoint. No automatic retry.', file=sys.stderr)
        sys.exit(1)
