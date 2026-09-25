import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const prelude =
  'sha256sum() { if [ -x /usr/bin/sha256sum ]; then /usr/bin/sha256sum "$@"; elif [ -x /bin/sha256sum ]; then /bin/sha256sum "$@"; else /usr/bin/shasum -a 256 "$@"; fi; }; stat() { if [ "$1" = -c ] && [ "$2" = %F ]; then [ -d "$3" ] && printf "directory\\n" || printf "regular file\\n"; elif [ "$1" = -c ] && [ "$2" = %s ]; then /usr/bin/wc -c <"$3" | /usr/bin/tr -d " "; else printf "1:2:81a4:10:501:20:644\\n"; fi; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

test('preserves a Compose parent while scanning its named volume before extends', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-volume-extends-'))
  );
  const bin = join(root, 'bin');
  const compose = join(root, 'compose.yaml');
  const inherited = join(root, 'base.yml');
  const volume = join(root, 'application-config');
  try {
    await Promise.all([mkdir(bin), mkdir(volume)]);
    await Promise.all([
      writeFile(
        compose,
        'services:\n  app:\n    extends:\n      file: ./base.yml\n      service: app\n    volumes:\n      - app-config:/app/config\nvolumes:\n  app-config:\n    name: application-config\n'
      ),
      writeFile(
        inherited,
        'services:\n  app:\n    environment:\n      OLLAMA_HOST: http://127.0.0.1:11434\n'
      ),
      writeFile(join(volume, 'runtime.env'), 'APP_CONFIG=enabled\n'),
      writeFile(
        join(bin, 'docker'),
        `#!/bin/sh
case "$*" in
  *'volume inspect -f {{json .}} application-config'*) printf '%s\\n' '{"Name":"application-config","Driver":"local","Mountpoint":"${volume}","Scope":"local"}' ;;
  *) exit 64 ;;
esac
`
      ),
    ]);
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(bin, 0o755),
      chmod(volume, 0o755),
      chmod(root, 0o755),
    ]);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
        'retire-ollama-compose-volume-extends-test',
        script.pathname,
        root,
      ],
      {
        ...unprivileged,
        env: { ...process.env, RETIRE_OLLAMA_TEST_BIN: bin },
      }
    );
    assert.match(stdout, new RegExp(`^${inherited}\\|`, 'm'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('accepts only the canonical /dev/null systemd mask link', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-canonical-mask-'))
  );
  const unit = join(root, 'application.service');
  const mask = join(root, 'masked.service');
  const scan = () =>
    execFileAsync('sh', [
      '-c',
      `${prelude}getent() { [ "$1" = passwd ] || return 2; return 0; }; systemctl() { return 0; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
      'retire-ollama-systemd-canonical-mask-test',
      script.pathname,
      root,
    ]);
  try {
    await Promise.all([
      writeFile(
        unit,
        '[Service]\nEnvironment=OLLAMA_HOST=http://127.0.0.1:11434\n'
      ),
      symlink('/dev/null', mask),
    ]);
    assert.match((await scan()).stdout, new RegExp(`^${unit}\\|`, 'm'));
    await unlink(mask);
    await symlink('/dev/zero', mask);
    await assert.rejects(scan(), (error) => error.code === 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
