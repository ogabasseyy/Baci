import hashlib
import json
from pathlib import Path
import re
import socket
from typing import Dict

from install_io import InstallRefused
from install_database import FIXTURE_CUSTOMER, FIXTURE_MERCHANT


ACCOUNT = 'baci-staging-test-payments'
ROOT = Path('/opt/baci-staging-test-payments')
CONFIG_ROOT = Path('/etc/baci/staging-test-payments')
PUBLIC_CONFIG = CONFIG_ROOT / 'config.json'
PAYSTACK_SECRET = CONFIG_ROOT / 'paystack-secret'
DATABASE_PASSWORD = CONFIG_ROOT / 'database-password'
POSTGRES_CA = Path('/etc/baci/piggyvest-staging/postgres-ca.pem')
HOSTED_PROFILE = Path('/home/bassey/baci-isolated-savings/hosted-public-client-profile.json')
HOSTED_PROFILE_SHA256 = 'c8d5623740c78fd766cc6ff6513929084e9db2c30237febf773694bbf0478ace'
SERVICE = 'baci-staging-test-payments.service'
DEADLINE_SERVICE = 'baci-staging-test-payments-deadline.service'
DEADLINE_TIMER = 'baci-staging-test-payments-deadline.timer'
EXPIRES_AT = '2026-09-29T15:59:10Z'
EXPIRY_EPOCH = 1790697550


def verify_payment_port() -> None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(('127.0.0.1', 4897))
    except OSError as error:
        raise InstallRefused('Test-payment port is occupied; existing listener left unchanged') from error


def validate_public_config(value: object) -> None:
    if not isinstance(value, dict) or set(value) != {'authOrigin', 'apiOrigin', 'anonKey', 'merchantId', 'customerIds'}:
        raise InstallRefused('Unexpected public configuration shape')
    if value['authOrigin'] != 'https://staging-auth.ogabassey.com' or value['apiOrigin'] != 'https://staging.ogabassey.com':
        raise InstallRefused('Non-staging public endpoint refused')
    if not isinstance(value['anonKey'], str) or not value['anonKey']:
        raise InstallRefused('Public anon key missing')
    if value['merchantId'] != FIXTURE_MERCHANT or value['customerIds'] != [FIXTURE_CUSTOMER]:
        raise InstallRefused('Approved staging fixture rejected')


def derive_runtime_config(declared: object) -> Dict[str, object]:
    validate_public_config(declared)
    profile = HOSTED_PROFILE.read_bytes()
    if hashlib.sha256(profile).hexdigest() != HOSTED_PROFILE_SHA256:
        raise InstallRefused('Hosted public profile hash drift')
    try:
        parsed = json.loads(profile)
    except json.JSONDecodeError as error:
        raise InstallRefused('Hosted public profile is invalid') from error
    if not isinstance(parsed, dict):
        raise InstallRefused('Hosted public profile is invalid')
    derived = {
        'authOrigin': parsed.get('supabaseOrigin'), 'apiOrigin': parsed.get('apiOrigin'),
        'anonKey': parsed.get('publicKey'), 'merchantId': parsed.get('merchantId'),
        'customerIds': declared['customerIds'],
    }
    validate_public_config(derived)
    if declared != derived:
        raise InstallRefused('Public runtime configuration does not match hosted profile')
    return derived


def render_unit() -> bytes:
    return f'''[Unit]
Description=Staging-only Paystack wallet test service
After=network-online.target

[Service]
Type=simple
User={ACCOUNT}
Group={ACCOUNT}
WorkingDirectory={ROOT}
BindReadOnlyPaths={ROOT}
LoadCredential=paystack-secret:{PAYSTACK_SECRET}
LoadCredential=database-password:{DATABASE_PASSWORD}
LoadCredential=config:{PUBLIC_CONFIG}
LoadCredential=postgres-ca:{POSTGRES_CA}
ExecCondition=/bin/sh -ec 'test "$(/usr/bin/date -u +%%s)" -lt {EXPIRY_EPOCH}'
ExecStartPre=/usr/bin/node {ROOT}/server.cjs --check
ExecStart=/usr/bin/node {ROOT}/server.cjs
Restart=no
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
RestrictNamespaces=yes
LockPersonality=yes
SystemCallArchitectures=native
UMask=0077
TimeoutStartSec=30s
TimeoutStopSec=5s

[Install]
WantedBy=multi-user.target
'''.encode()


def render_deadline_units() -> Dict[str, bytes]:
    return {
        DEADLINE_SERVICE: f'''[Unit]\nDescription=Expire staging wallet test payments\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/systemctl stop {SERVICE}\n'''.encode(),
        DEADLINE_TIMER: f'''[Unit]\nDescription=Stop staging wallet test payments at fixed expiry\n\n[Timer]\nOnCalendar=2026-09-29 15:59:10 UTC\nPersistent=true\nUnit={DEADLINE_SERVICE}\n\n[Install]\nWantedBy=timers.target\n'''.encode(),
    }
