"""Root-owned bounded command and cooperative lock lifetime for rollback only."""

import fcntl
import os
from pathlib import Path
import stat
import subprocess


LOCKS = ('/root/baci-complete-replay-cutover.lock',
    '/run/lock/baci-isolated-savings-admin.lock', '/run/baci-notifications-renewal.lock')
DATABASES = {
    'baci-isolated-savings-db-1': ('/usr/bin/psql', 'postgres'),
    'pvb-staging-receipts-db': ('/usr/local/bin/psql', 'supabase_admin'),
}


def require(value):
    if not value:
        raise ValueError('rehearsal_command_refused')


def command(argv, input=None, timeout=30):
    try:
        require(type(argv) is list and all(type(value) is str and '\0' not in value for value in argv)
            and type(timeout) is int and 0 < timeout <= 60
            and (input is None or type(input) is bytes and 0 < len(input) <= 16000000))
        normalized = argv[:]
        if normalized[:2] == ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']:
            normalized.pop(1)
        if input is not None:
            require(len(normalized) == 12 and normalized[:3] == ['/usr/bin/docker', 'exec', '-i']
                and normalized[3] in DATABASES)
            client, role = DATABASES[normalized[3]]
            require(normalized[4:] == [client, '-X', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', 'postgres'])
        else:
            require(len(normalized) >= 2 and (
                normalized[0] == '/usr/bin/docker' and normalized[1] in ('inspect', 'ps')
                or normalized[0] == '/usr/bin/docker' and len(normalized) >= 3
                and normalized[1] == 'container' and normalized[2] in ('inspect', 'ls')
                or normalized[0] == '/usr/bin/systemctl'
                and normalized[1] in ('show', 'list-jobs', 'list-units', 'list-unit-files')
                or normalized == ['/usr/bin/ps', '-eo', 'pid=,ppid=,comm=,args=']))
        result = subprocess.run(argv, input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout, check=False, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin',
                'HOME': '/root', 'LANG': 'C', 'LC_ALL': 'C', 'DOCKER_HOST': 'unix:///var/run/docker.sock'})
        require(result.returncode == 0 and len(result.stdout) <= 16000000)
        return result.stdout
    except Exception:
        raise ValueError('rehearsal_command_refused') from None


def verify_lock_parent(path, info):
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
        and (not info.st_mode & 0o022
            or path == Path('/run/lock') and stat.S_IMODE(info.st_mode) == 0o1777))


class HeldLocks:
    def __init__(self):
        self.handles = []

    def __enter__(self):
        try:
            for name in LOCKS:
                path = Path(name)
                for parent in path.parents:
                    info = parent.lstat()
                    verify_lock_parent(parent, info)
                descriptor = os.open(name, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
                self.handles.append((name, descriptor))
                info = os.fstat(descriptor)
                require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                    and not info.st_mode & 0o022)
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            require(self.held())
            return self
        except Exception:
            self.__exit__(None, None, None)
            raise ValueError('rehearsal_lock_refused') from None

    def held(self):
        require(len(self.handles) == len(LOCKS))
        for name, descriptor in self.handles:
            opened, current = os.fstat(descriptor), Path(name).lstat()
            require(stat.S_ISREG(current.st_mode) and current.st_uid == 0
                and current.st_nlink == 1 and not current.st_mode & 0o022
                and (opened.st_dev, opened.st_ino) == (current.st_dev, current.st_ino))
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True

    def __exit__(self, *unused):
        for _, descriptor in reversed(self.handles):
            os.close(descriptor)
        self.handles = []
