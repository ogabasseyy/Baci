import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess


DEPLOYMENT = 'dpl_GBjPR9eaFg4FUneTNmDypFQfuKNc'
PROJECT = 'prj_vgV7DiXC52wOhbClB2uzjGAg9IZd'
TEAM = 'team_P85yMqd79TPq8aSGSt2kojWY'
SCOPE = 'basseys-projects-d7395611'
NOTIFICATIONS = '/api/storefront/customer/savings/notifications'
FILES = {
    'config.json': '29c09f5cf5c71179928e6a2e293d3f409c124856',
    'functions/api/webhooks/piggyvest.func/.vc-config.json': '0005e94aaa724eb52ac0d76b5631c4c9ebe007d8',
    'functions/api/webhooks/piggyvest.func/index.mjs': 'c71b6e89b07b00d116e87d29d334f05f2f8881b3',
}


def extend(baseline):
    routes = baseline.get('routes')
    if set(baseline) != {'version', 'routes'} or baseline['version'] != 3:
        raise RuntimeError('Unexpected proxy schema')
    if not isinstance(routes, list) or not routes or routes[-1] != {'handle': 'filesystem'}:
        raise RuntimeError('Receiver fallthrough missing')
    if any(NOTIFICATIONS in str(route) for route in routes):
        raise RuntimeError('Notification proxy already exists')
    return {'version': 3, 'routes': [*routes[:-1], {
        'src': '^' + NOTIFICATIONS + '$',
        'dest': 'https://staging-auth.ogabassey.com' + NOTIFICATIONS,
        'methods': ['GET', 'PATCH'],
    }, {'src': '^' + NOTIFICATIONS + '$', 'status': 405}, routes[-1]]}


def download(identifier):
    result = subprocess.run([
        'vercel', 'api', f'/v7/deployments/{DEPLOYMENT}/files/{identifier}',
        '--scope', SCOPE, '--raw',
    ], capture_output=True, text=True, timeout=45, check=True)
    raw = base64.b64decode(json.loads(result.stdout)['data'], validate=True)
    if hashlib.sha1(raw).hexdigest() != identifier:
        raise RuntimeError('Previous deployment file identity mismatch')
    return raw


def prepare(directory):
    if directory.exists() or directory.is_symlink():
        raise RuntimeError('Output directory already exists')
    downloaded = {name: download(identifier) for name, identifier in FILES.items()}
    config = extend(json.loads(downloaded['config.json']))
    directory.mkdir(mode=0o700, exist_ok=False)
    project_directory = directory / '.vercel'
    output = project_directory / 'output'
    for name, content in downloaded.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content if name != 'config.json' else json.dumps(config).encode())
    (project_directory / 'project.json').write_text(json.dumps({
        'projectId': PROJECT, 'orgId': TEAM, 'projectName': 'ogabassey-piggyvest-staging',
    }))
    (directory / 'baseline-config.json').write_bytes(downloaded['config.json'])
    receipt = {
        'sourceDeployment': DEPLOYMENT, 'projectId': PROJECT,
        'receiverSha256': hashlib.sha256(downloaded['functions/api/webhooks/piggyvest.func/index.mjs']).hexdigest(),
        'proxyRowsAdded': 2,
    }
    (directory / 'preparation.json').write_text(json.dumps(receipt, indent=2))
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    arguments = parser.parse_args()
    try:
        print(json.dumps(prepare(arguments.out)))
    except Exception as error:
        print(json.dumps({'status': 'refused', 'errorType': type(error).__name__}))
        raise SystemExit(1) from None
