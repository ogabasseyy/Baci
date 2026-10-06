import hashlib
import os
import re
import stat
import subprocess

ACCOUNT = 'baci-savings-gateway'
GROUP = 'baci-savings-ingress'
CODE = '/opt/baci-savings-gateway'
CONFIG = '/etc/baci-savings-gateway'
UNIT = '/etc/systemd/system/baci-savings-gateway.service'
SUDOERS = '/etc/sudoers.d/baci-savings-gateway'
STATE = '/var/lib/baci-savings-gateway-install'
RUNTIME = '/run/baci-savings-gateway'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'HOME': '/'}
RUNTIME_FILES = (
    'managed-gateway-cli.mjs', 'managed-gateway.mjs', 'managed-files.mjs',
    'managed-inventory-helper.mjs', 'private-routing.mjs',
    'private-routing-inventory.mjs', 'private-routing-supervisor-inventory.mjs',
    'private-routing-supervisor-child.py', 'compose.mjs',
)
INSTALLER_FILES = ('install-managed-gateway.py', 'managed-install-policy.py', 'managed-install-transaction.py')
FILES = RUNTIME_FILES + INSTALLER_FILES + ('managed-gateway.service', 'managed-gateway.sudoers')
VERSIONS = {
    '/usr/bin/node': ['--version'], '/usr/bin/python3': ['--version'],
    '/usr/sbin/nginx': ['-v'], '/usr/bin/docker': ['--version'],
    '/usr/bin/sudo': ['--version'], '/usr/sbin/visudo': ['--version'],
    '/usr/bin/systemctl': ['--version'], '/usr/bin/systemd-analyze': ['--version'],
}
UTILITIES = ('/usr/sbin/groupadd', '/usr/sbin/useradd', '/usr/sbin/userdel', '/usr/sbin/groupdel', '/usr/sbin/nologin', '/usr/bin/passwd')


def require(value, message):
    if not value:
        raise RuntimeError(message)


def metadata(info, directory=False, readonly=False):
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)), 'Unexpected file type')
    require(info.st_uid == 0 and not info.st_mode & 0o022, 'Untrusted ownership or permissions')
    require(not info.st_mode & 0o7000, 'Special permission bits refused')
    if not directory:
        require(info.st_nlink == 1, 'Hardlinks refused')
    if readonly:
        require(not info.st_mode & 0o222, 'Read-only source required')


def parents(path):
    directory = os.path.dirname(path)
    while True:
        metadata(os.lstat(directory), directory=True)
        if directory == '/':
            return
        directory = os.path.dirname(directory)


def read(path, readonly=True):
    parents(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        metadata(before, readonly=readonly)
        require(before.st_size <= 1048576, 'Input too large')
        content = handle.read(1048577)
        after = os.fstat(handle.fileno())
        require((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Input changed')
        require(len(content) <= 1048576, 'Input too large')
        return content


def run(arguments, allowed=(0,)):
    result = subprocess.run(arguments, env=ENV, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15, check=False)
    if result.returncode not in allowed:
        raise subprocess.CalledProcessError(result.returncode, ())
    require(len(result.stdout) < 1048576, 'Command output too large')
    return result.stdout.decode('utf8', errors='strict').strip()


def binary(path):
    current = path
    for _attempt in range(16):
        parents(current)
        info = os.lstat(current)
        if not stat.S_ISLNK(info.st_mode):
            break
        require(info.st_uid == 0, 'Untrusted binary symlink')
        target = os.readlink(current)
        current = os.path.normpath(os.path.join(os.path.dirname(current), target))
    else:
        raise RuntimeError('Binary symlink chain refused')
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
            'Untrusted binary')
    require(info.st_mode & 0o111, 'Executable required')
    require(not info.st_mode & stat.S_ISGID, 'Setgid binary refused')
    require(not info.st_mode & stat.S_ISUID or path in ('/usr/bin/sudo', '/usr/bin/passwd'),
            'Setuid binary refused')
    require('security.capability' not in os.listxattr(current), 'File capabilities refused')
    return current


def validate_bundle(manifest, payloads):
    require(set(manifest) == {'version', 'files', 'versions'} and manifest['version'] == 1, 'Manifest shape refused')
    require(set(manifest['files']) == set(FILES) == set(payloads), 'Import closure mismatch')
    require(set(manifest['versions']) == set(VERSIONS), 'Binary inventory incomplete')
    for name, expected in manifest['files'].items():
        require(re.fullmatch('[0-9a-f]{64}', expected or '') is not None, 'Digest required')
        require(hashlib.sha256(payloads[name]).hexdigest() == expected, 'Source checksum mismatch')
    for expected in manifest['versions'].values():
        require(isinstance(expected, str) and expected and '\n' not in expected and
                'REVIEW_REQUIRED' not in expected, 'Reviewed binary versions required')
    for name in RUNTIME_FILES:
        if name.endswith('.mjs'):
            source = payloads[name].decode()
            require(not re.search(r'\b(?:import|require)\s*\(', source), 'Dynamic imports require review')
            for dependency in re.findall(r"(?:from\s*|import\s*)['\"]([^'\"]+)", source):
                require(dependency.startswith('node:') or dependency.startswith('./') and
                        dependency[2:] in RUNTIME_FILES, 'Unbundled import refused')
    unit = payloads['managed-gateway.service'].decode()
    require('[Install]' not in unit and '\nRestart=no\n' in unit and '\nUser=' + ACCOUNT + '\n' in unit,
            'Inactive dedicated unit required')


def validate_binaries(versions):
    for path in (*VERSIONS, *UTILITIES):
        binary(path)
    for path, arguments in VERSIONS.items():
        actual = run([path, *arguments]).splitlines()[0]
        require(actual == versions[path], 'Binary version mismatch')
    require(re.fullmatch(r'v24\.\d+\.\d+', versions['/usr/bin/node']), 'Node 24 required')
    require(versions['/usr/sbin/nginx'] == 'nginx version: nginx/1.30.3', 'Reviewed nginx required')
    require(re.match(r'systemd 255\b', versions['/usr/bin/systemctl']), 'Re-review systemd version')


def inactive():
    output = run(['/usr/bin/systemctl', 'show', '--property=LoadState,ActiveState,UnitFileState,DropInPaths', ACCOUNT + '.service'])
    fields = dict(line.split('=', 1) for line in output.splitlines())
    require(set(fields) == {'LoadState', 'ActiveState', 'UnitFileState', 'DropInPaths'}, 'Service state is ambiguous')
    require(fields['LoadState'] in ('not-found', 'loaded') and fields['ActiveState'] in ('inactive', 'failed'), 'Service is not inactive')
    require(fields['UnitFileState'] in ('', 'disabled', 'static') and not fields['DropInPaths'], 'Enabled service or drop-ins refused')
    require(not os.path.lexists(RUNTIME), 'Runtime collision; do not stop another process')
    return fields


def preflight(manifest, payloads, pwd, grp):
    validate_bundle(manifest, payloads)
    validate_binaries(manifest['versions'])
    for destination in (CODE, CONFIG, UNIT, SUDOERS, STATE):
        parents(destination)
        require(not os.path.lexists(destination), 'Destination collision')
    for path in ('/etc/systemd/system/', '/run/systemd/system/', '/usr/lib/systemd/system/', '/lib/systemd/system/'):
        require(not os.path.lexists(path + 'service.d'), 'Global unit drop-ins require separate review')
        for suffix in ('.service', '.service.d'):
            require(not os.path.lexists(path + ACCOUNT + suffix), 'Unit or drop-in collision')
        if os.path.isdir(path):
            for name in os.listdir(path):
                if name.endswith(('.wants', '.requires')):
                    require(not os.path.lexists(path + name + '/' + ACCOUNT + '.service'), 'Activation link collision')
    for lookup, name in ((pwd.getpwnam, ACCOUNT), (grp.getgrnam, GROUP)):
        try:
            lookup(name)
        except KeyError:
            continue
        raise RuntimeError('Account or group collision')
    require(inactive()['LoadState'] == 'not-found', 'Existing loaded unit refused')
