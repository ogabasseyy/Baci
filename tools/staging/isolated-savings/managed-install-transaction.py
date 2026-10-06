import hashlib
import json
import os
import stat


class Installation:
    def __init__(self, policy, pwd, grp, digest, entries=None):
        self.policy, self.pwd, self.grp = policy, pwd, grp
        self.digest, self.entries = digest, entries or []
        self.receipt = policy.STATE + '/receipt.json'
        self.stage = 'state-create'

    def save(self):
        content = json.dumps({'version': 1, 'manifestSha256': self.digest, 'entries': self.entries}, sort_keys=True).encode()
        descriptor = os.open(self.receipt, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            self.policy.metadata(os.fstat(handle.fileno()))
            handle.write(content)
            handle.truncate()
            handle.flush()
            os.fsync(handle.fileno())

    def directory(self, path, gid, mode):
        os.mkdir(path, mode)
        info = os.lstat(path)
        self.entries.append({'kind': 'directory', 'path': path, 'dev': info.st_dev, 'ino': info.st_ino,
                             'gid': info.st_gid, 'mode': stat.S_IMODE(info.st_mode)})
        self.save()
        os.chown(path, 0, gid)
        os.chmod(path, mode)
        self.entries[-1].update(gid=os.lstat(path).st_gid, mode=mode)
        self.save()

    def file(self, path, content, gid, mode):
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            os.fchown(handle.fileno(), 0, gid)
            os.fchmod(handle.fileno(), mode)
            info = os.fstat(handle.fileno())
        self.entries.append({'kind': 'file', 'path': path, 'dev': info.st_dev, 'ino': info.st_ino,
                             'gid': info.st_gid, 'mode': stat.S_IMODE(info.st_mode),
                             'sha256': hashlib.sha256(content).hexdigest()})
        self.save()

    def install(self, payloads):
        policy = self.policy
        self.stage = 'state-create'
        os.mkdir(policy.STATE, 0o700)
        self.save()
        try:
            self.stage = 'group-create'
            policy.run(['/usr/sbin/groupadd', '--system', policy.GROUP])
            gid = self.grp.getgrnam(policy.GROUP).gr_gid
            self.entries.append({'kind': 'group', 'gid': gid})
            self.save()
            self.stage = 'user-create'
            policy.run(['/usr/sbin/useradd', '--system', '--no-create-home', '--no-user-group', '--no-log-init',
                        '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin',
                        '--gid', str(gid), '--password', '!', policy.ACCOUNT])
            uid = self.pwd.getpwnam(policy.ACCOUNT).pw_uid
            policy.require(uid > 0 and gid > 0, 'Dedicated non-root identity required')
            self.entries.append({'kind': 'user', 'uid': uid, 'gid': gid})
            self.save()
            self.stage = 'account-lock-check'
            policy.require(policy.run(['/usr/bin/passwd', '-S', policy.ACCOUNT]).split()[1] == 'L', 'Locked account required')
            self.stage = 'code-directory-create'
            self.directory(policy.CODE, gid, 0o750)
            self.stage = 'config-directory-create'
            self.directory(policy.CONFIG, gid, 0o750)
            self.stage = 'runtime-code-stage'
            for name in policy.RUNTIME_FILES:
                mode = 0o550 if name == 'managed-inventory-helper.mjs' else 0o440
                self.file(policy.CODE + '/' + name, payloads[name], gid, mode)
            self.stage = 'validation-files-stage'
            self.file(policy.CODE + '/baci-savings-gateway.service', payloads['managed-gateway.service'], 0, 0o400)
            self.file(policy.CODE + '/managed-gateway.sudoers', payloads['managed-gateway.sudoers'], 0, 0o400)
            self.stage = 'sudoers-candidate-validate'
            policy.run(['/usr/sbin/visudo', '-cf', policy.CODE + '/managed-gateway.sudoers'])
            self.stage = 'systemd-unit-verify'
            policy.run(['/usr/bin/systemd-analyze', 'verify', policy.CODE + '/baci-savings-gateway.service'])
            self.stage = 'sudoers-install'
            self.file(policy.SUDOERS, payloads['managed-gateway.sudoers'], 0, 0o440)
            self.stage = 'sudoers-global-validate'
            policy.run(['/usr/sbin/visudo', '-c'])
            self.stage = 'unit-install'
            self.file(policy.UNIT, payloads['managed-gateway.service'], 0, 0o444)
            self.stage = 'daemon-reload'
            policy.run(['/usr/bin/systemctl', 'daemon-reload'])
            self.stage = 'inactive-confirm'
            policy.inactive()
        except BaseException as original:
            original.install_stage = self.stage
            try:
                self.rollback()
            except BaseException as secondary:
                secondary.install_stage = self.stage
                original.rollback_error = secondary
            raise

    def verify(self):
        policy = self.policy
        policy.inactive()
        allowed_files = {policy.CODE + '/' + name for name in policy.RUNTIME_FILES}
        allowed_files.update((policy.CODE + '/baci-savings-gateway.service', policy.CODE + '/managed-gateway.sudoers', policy.UNIT, policy.SUDOERS))
        allowed_directories = {policy.CODE, policy.CONFIG}
        for entry in self.entries:
            kind = entry.get('kind')
            if kind in ('file', 'directory'):
                path = entry['path']
                policy.require(path in (allowed_files if kind == 'file' else allowed_directories), 'Rollback path refused')
                policy.parents(path)
                info = os.lstat(path)
                policy.metadata(info, directory=kind == 'directory')
                policy.require((info.st_dev, info.st_ino, info.st_gid, stat.S_IMODE(info.st_mode)) ==
                               (entry['dev'], entry['ino'], entry['gid'], entry['mode']), 'Rollback metadata changed')
                if kind == 'file':
                    policy.require(hashlib.sha256(policy.read(path)).hexdigest() == entry['sha256'], 'Rollback content changed')
                else:
                    expected = {os.path.basename(item['path']) for item in self.entries
                                if item.get('path') and os.path.dirname(item['path']) == path}
                    policy.require(set(os.listdir(path)) == expected, 'Unrecorded directory contents refused')
            elif kind == 'user':
                user = self.pwd.getpwnam(policy.ACCOUNT)
                policy.require((user.pw_uid, user.pw_gid, user.pw_dir, user.pw_shell) ==
                               (entry['uid'], entry['gid'], '/nonexistent', '/usr/sbin/nologin'), 'Account changed')
                policy.require(policy.run(['/usr/bin/passwd', '-S', policy.ACCOUNT]).split()[1] == 'L', 'Account lock changed')
                for name in os.listdir('/proc'):
                    if name.isdigit():
                        try:
                            policy.require(os.stat('/proc/' + name).st_uid != user.pw_uid, 'Account has running processes')
                        except FileNotFoundError:
                            continue
            elif kind == 'group':
                group = self.grp.getgrnam(policy.GROUP)
                policy.require(group.gr_gid == entry['gid'] and not group.gr_mem, 'Group changed')
                policy.require(all(user.pw_name == policy.ACCOUNT or user.pw_gid != group.gr_gid
                                   for user in self.pwd.getpwall()), 'Group used by another account')
            else:
                raise RuntimeError('Rollback record refused')

    def rollback(self):
        self.stage = 'rollback-verify'
        self.verify()
        self.stage = 'rollback-remove'
        while self.entries:
            entry = self.entries[-1]
            if entry['kind'] == 'file':
                os.unlink(entry['path'])
            elif entry['kind'] == 'directory':
                os.rmdir(entry['path'])
            elif entry['kind'] == 'user':
                self.policy.run(['/usr/sbin/userdel', self.policy.ACCOUNT])
            else:
                self.policy.run(['/usr/sbin/groupdel', self.policy.GROUP])
            self.entries.pop()
            self.save()
        self.stage = 'rollback-daemon-reload'
        self.policy.run(['/usr/bin/systemctl', 'daemon-reload'])
        self.stage = 'rollback-state-remove'
        os.unlink(self.receipt)
        os.rmdir(self.policy.STATE)
