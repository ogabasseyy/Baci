#!/usr/bin/env python3
"""systemd unit rendering for the funding service candidate."""

import importlib.util
import sys
from pathlib import Path

def _load_sibling(name: str):
    """Load a focused funding-service module once per process.

    Dash-named siblings cannot use plain imports; every module resolves them
    through this importlib loader with sys.modules singletons so the whole
    graph shares one Refused class and one set of base constants.
    """
    key = f'funding_service_{name}'
    cached = sys.modules.get(key)
    if cached is not None:
        return cached
    spec = importlib.util.spec_from_file_location(
        key, Path(__file__).parent / f'funding-service-{name}.py'
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Funding service {name} module is unavailable.')
    module = importlib.util.module_from_spec(spec)
    sys.modules[key] = module
    spec.loader.exec_module(module)
    return module


_base = _load_sibling('candidate')
ARTIFACT_ROOT = _base.ARTIFACT_ROOT
SERVICE_ACCOUNT = _base.SERVICE_ACCOUNT
SERVICE_GROUP = _base.SERVICE_GROUP
CONFIG_PATH = _base.CONFIG_PATH
DB_CA_CREDENTIAL = _base.DB_CA_CREDENTIAL
DB_CA_PATH = _base.DB_CA_PATH
UNIT_NAME = _base.UNIT_NAME
DEADLINE_SERVICE_NAME = _base.DEADLINE_SERVICE_NAME
LEASE_DEADLINE = _base.LEASE_DEADLINE
LEASE_DEADLINE_EPOCH = _base.LEASE_DEADLINE_EPOCH

# sha256 of the service unit installed on isolated staging by the candidate
# revision before the CREDENTIALS_DIRECTORY unset. The update mode rewrites
# the unit only when the on-disk bytes match this pin or are already current.
PRIOR_UNIT_SHA256 = '4a010621766ed0740b3ac11c3692692012558771e4a40ede71b20def07b41453'


def render_unit() -> str:
    return f'''[Unit]
Description=Bounded hosted savings funding server (staging loopback)
After=network-online.target

[Service]
Type=simple
User={SERVICE_ACCOUNT}
Group={SERVICE_GROUP}
WorkingDirectory={ARTIFACT_ROOT}/apps/web
BindReadOnlyPaths={ARTIFACT_ROOT}
EnvironmentFile={CONFIG_PATH}
LoadCredential={DB_CA_CREDENTIAL}:{DB_CA_PATH}
ExecCondition=/bin/sh -c 'test "$BACI_SAVINGS_LEASE_EXPIRES_AT" = "{LEASE_DEADLINE_EPOCH}" && test "$(/bin/date -u +%%s)" -lt "{LEASE_DEADLINE_EPOCH}"'
ExecStart=/bin/sh -c 'export {DB_CA_CREDENTIAL}="$(cat $CREDENTIALS_DIRECTORY/{DB_CA_CREDENTIAL})"; unset CREDENTIALS_DIRECTORY; exec /usr/bin/env NODE_ENV=production BACI_WORKER_PROFILE=hosted-savings-funding PORT=4795 HOSTNAME=127.0.0.1 /usr/bin/node server.js'
Restart=no
KillMode=control-group
TimeoutStopSec=5s
LimitCORE=0
RuntimeMaxSec=7d
NoNewPrivileges=yes
CapabilityBoundingSet=
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UMask=0007
StandardOutput=journal
StandardError=journal
'''


def render_deadline_service() -> str:
    return f'''[Unit]
Description=Stop hosted savings funding at the staging lease deadline

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl stop {UNIT_NAME}
'''


def render_deadline_timer() -> str:
    return f'''[Unit]
Description=Absolute staging lease deadline for hosted savings funding

[Timer]
OnCalendar={LEASE_DEADLINE}
AccuracySec=1s
Unit={DEADLINE_SERVICE_NAME}

[Install]
WantedBy=timers.target
'''
