import argparse
import hashlib
import json
from pathlib import Path
import shutil


PROJECT = 'prj_vgV7DiXC52wOhbClB2uzjGAg9IZd'
TEAM = 'team_P85yMqd79TPq8aSGSt2kojWY'
RECEIVER_HASH = '37e9b485a83345d0e7b6cdc17b541fbd76a783cc23b597f9b57b1af971a6073a'
PATHS = (
    '/api/storefront/customer/wallet/top-up/initialize',
    '/api/storefront/customer/wallet/top-up/confirm',
    '/api/storefront/customer/savings/contributions/manual',
)


def extend(baseline):
    if set(baseline) != {'version', 'routes'} or baseline['version'] != 3:
        raise RuntimeError('Unexpected proxy configuration')
    routes = baseline['routes']
    if not isinstance(routes, list) or not routes or routes[-1] != {'handle': 'filesystem'}:
        raise RuntimeError('Webhook receiver fallthrough missing')
    if any(path in json.dumps(routes) for path in PATHS):
        raise RuntimeError('Payment proxy is already configured')
    additions = []
    for path in PATHS:
        additions.extend([
            {'src': '^' + path + '$', 'dest': 'https://staging-auth.ogabassey.com' + path, 'methods': ['POST']},
            {'src': '^' + path + '$', 'status': 405},
        ])
    return {'version': 3, 'routes': routes[:-1] + additions + routes[-1:]}


def prepare(source, destination):
    project = json.loads((source / '.vercel/project.json').read_text())
    if project.get('projectId') != PROJECT or project.get('orgId') != TEAM:
        raise RuntimeError('Not the isolated staging Vercel project')
    receiver = Path('.vercel/output/functions/api/webhooks/piggyvest.func/index.mjs')
    if hashlib.sha256((source / receiver).read_bytes()).hexdigest() != RECEIVER_HASH:
        raise RuntimeError('PiggyVest receiver changed')
    config = extend(json.loads((source / '.vercel/output/config.json').read_text()))
    if destination.exists() or destination.is_symlink():
        raise RuntimeError('Refusing to overwrite an existing artifact')
    shutil.copytree(source / '.vercel', destination / '.vercel', symlinks=False)
    (destination / '.vercel/output/config.json').write_text(json.dumps(config))
    return {'staged': True, 'project': PROJECT, 'receiverUnchanged': True, 'deployed': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    arguments = parser.parse_args()
    print(json.dumps(prepare(arguments.source, arguments.destination)))
