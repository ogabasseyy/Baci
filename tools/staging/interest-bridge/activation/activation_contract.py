from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import stat


DEADLINE = '2026-10-06T15:59:10Z'
EPOCH = int(datetime.fromisoformat(DEADLINE.replace('Z', '+00:00')).timestamp())
CONFIGURATION = Path('/root/baci-interest-readiness.e4yrt2wn/interest-config.json')
DAEMON = Path('/root/baci-interest-proof.dski7oy5/replay-daemon.mjs')
CONFIGURATION_SHA = 'e3807cb1ac63d438b2cff39df27fc39549ba662ae9774c670b7c105c6816916b'
DAEMON_SHA = '02420ef54fe4061cb676ae01003acf4ed9c9280d22a1b3ca0d05e94bd9fe1457'
IMAGE = 'sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553'
CONTAINER = 'baci-interest-replay'
TARGET = Path('/opt/baci-interest-replay')
SERVICE = 'baci-interest-replay.service'
DEADLINE_SERVICE = 'baci-interest-replay-deadline.service'
DEADLINE_TIMER = 'baci-interest-replay-deadline.timer'


def verified_file(path, mode, digest):
    for parent in path.parents:
        metadata = parent.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise ValueError('unsafe-parent')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != mode or not 0 < info.st_size <= 2000000):
            raise ValueError('unsafe-file')
        content = stream.read(2000001)
    if hashlib.sha256(content).hexdigest() != digest:
        raise ValueError('file-pin')
    return content


def render_sql(source, digest, apply=False):
    if hashlib.sha256(source).hexdigest() != digest:
        raise ValueError('sql-pin')
    text = source.decode()
    if (not text.startswith('BEGIN;\n') or text.count('__FINISH__') != 1
            or 'COMMIT;' in text or 'ROLLBACK;' in text or '\\' in text):
        raise ValueError('sql-framing')
    return text.replace('__FINISH__', 'COMMIT;' if apply else 'ROLLBACK;')


def validate_window(now=None):
    instant = now or datetime.now(timezone.utc)
    if instant.tzinfo is None or instant.timestamp() >= EPOCH-180:
        raise ValueError('deadline-expired')


def unit_files():
    return {
        SERVICE: f'''[Unit]
Description=Restricted staging paid-interest replay
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=simple
ExecCondition=/bin/sh -c '[ "$(/usr/bin/date -u +%%s)" -lt {EPOCH} ]'
ExecStart=/usr/bin/docker start -a {CONTAINER}
ExecStop=/usr/bin/docker stop --time 10 {CONTAINER}
TimeoutStopSec=20s
Restart=no
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
StandardOutput=journal
StandardError=journal
'''.encode(),
        DEADLINE_SERVICE: f'''[Unit]
Description=Stop restricted staging interest at approved expiry

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl stop {SERVICE}
ExecStart=/usr/bin/docker stop --time 10 {CONTAINER}
'''.encode(),
        DEADLINE_TIMER: f'''[Unit]
Description=Expire restricted staging interest replay

[Timer]
OnCalendar=2026-10-06 15:59:10 UTC
AccuracySec=1s
Persistent=true
Unit={DEADLINE_SERVICE}

[Install]
WantedBy=timers.target
'''.encode(),
    }
