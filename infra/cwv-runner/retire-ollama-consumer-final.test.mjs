import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const containerId =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const prelude =
  'sha256sum() { /usr/bin/shasum -a 256 "$@"; }; stat() { if [ "$1" = -c ] && [ "$2" = %d ]; then printf 1; elif [ "$1" = -c ] && [ "$2" = %F ]; then [ -d "$3" ] && printf "directory\\n" || printf "regular file\\n"; elif [ "$1" = -c ] && [ "$2" = %s ]; then /usr/bin/wc -c <"$3" | /usr/bin/tr -d " "; elif [ "$1" = -c ] && [ "$2" = "%f:%s:%u:%g:%a" ]; then printf "81a4:17:501:20:644\\n"; else inode=$(/bin/ls -di "$3" | /usr/bin/awk "{print \\$1}"); printf "1:%s:81a4:10:501:20:644\\n" "$inode"; fi; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

async function scanVolume(directory, mounts, volume) {
  const bin = join(directory, 'bin');
  const state = join(directory, 'state');
  await Promise.all([
    mkdir(bin, { recursive: true }),
    mkdir(state, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(state, 'mounts.json'), JSON.stringify(mounts)),
    writeFile(join(state, 'volume.json'), JSON.stringify(volume)),
    writeFile(
      join(bin, 'docker'),
      `#!/bin/sh
case "$*" in
  *' ps -a '*) printf '${containerId}\\n' ;;
  *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;;
  *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;;
  *' cp ${containerId}:/bin/true '*) for destination do :; done; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;;
  *'inspect -f {{.Id}} '* ) printf '${containerId} /generic-api /bin/true [] [] '; cat '${state}/mounts.json'; printf ' {} {} {} [] "bridge"\\n' ;;
  *'inspect -f {{json .Mounts}} ${containerId}') cat '${state}/mounts.json' ;;
  *'volume inspect -f {{json .}} '*) cat '${state}/volume.json' ;;
esac
`
    ),
  ]);
  await Promise.all([
    chmod(join(bin, 'docker'), 0o755),
    chmod(directory, 0o755),
  ]);
  return execFileAsync(
    'sh',
    [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all`,
      'retire-ollama-volume-test',
      script.pathname,
    ],
    {
      ...unprivileged,
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_BIN: bin,
      },
    }
  );
}

test('keeps the Nginx parent binding across wildcard siblings', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-nginx-parent-'))
  );
  const root = join(directory, 'nginx');
  const parent = join(root, 'nginx.conf');
  const children = join(root, 'sites');
  try {
    await mkdir(children, { recursive: true });
    await Promise.all([
      writeFile(parent, 'include sites/*.conf;\n'),
      writeFile(join(children, 'first.conf'), 'server_name first;\n'),
      writeFile(
        join(children, 'second.conf'),
        'proxy_pass http://127.0.0.1:11434;\n'
      ),
    ]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); NGINX_ROOT="$2"; init_temp_root; trap cleanup_temp EXIT; scan_nginx_definitions`,
      'retire-ollama-nginx-parent-test',
      script.pathname,
      root,
    ]);
    assert.match(
      stdout,
      new RegExp(`^${parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`, 'm')
    );
    assert.doesNotMatch(
      stdout,
      new RegExp(
        `^${join(children, 'first.conf').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`,
        'm'
      )
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('emits only hashed bindings for matching local named-volume files', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-volume-match-'))
  );
  const root = join(directory, 'model-cache');
  try {
    await mkdir(root);
    await writeFile(
      join(root, 'runtime.env'),
      'OLLAMA_HOST=http://127.0.0.1:11434\n'
    );
    const { stdout } = await scanVolume(
      directory,
      [
        {
          Type: 'volume',
          Name: 'model-cache',
          Source: root,
          Destination: '/app/cache',
          Driver: 'local',
          Mode: 'z',
          RW: true,
          Propagation: '',
        },
      ],
      { Name: 'model-cache', Driver: 'local', Mountpoint: root, Scope: 'local' }
    );
    const fields = stdout.trim().split('|');
    assert.equal(fields.length, 5);
    assert.match(fields[0], /^container-volume:[0-9a-f]{64}$/);
    for (const field of fields.slice(1)) assert.match(field, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(
      stdout,
      /generic-api|model-cache|\/app\/cache|runtime\.env/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('ignores nonmatching local named-volume files and rejects forged or symlinked volumes', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-volume-reject-'))
  );
  const root = join(directory, 'model-cache');
  const outside = join(directory, 'outside');
  try {
    await Promise.all([mkdir(root), mkdir(outside)]);
    await writeFile(join(root, 'runtime.env'), 'OTHER=1\n');
    const mounts = [
      {
        Type: 'volume',
        Name: 'model-cache',
        Source: root,
        Destination: '/app/cache',
        Driver: 'local',
        Mode: 'z',
        RW: true,
        Propagation: '',
      },
    ];
    const volume = {
      Name: 'model-cache',
      Driver: 'local',
      Mountpoint: root,
      Scope: 'local',
    };
    assert.equal((await scanVolume(directory, mounts, volume)).stdout, '');
    await assert.rejects(
      scanVolume(join(directory, 'forged'), mounts, {
        ...volume,
        Mountpoint: outside,
      }),
      (error) => error.code === 2
    );
    await assert.rejects(
      scanVolume(
        join(directory, 'malformed'),
        [{ ...mounts[0], RW: undefined }],
        volume
      ),
      (error) => error.code === 2
    );
    await mkdir(join(directory, 'linked'));
    await symlink(outside, join(root, 'escape'));
    await assert.rejects(
      scanVolume(join(directory, 'symlinked'), mounts, volume),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses the complete fixed system-manager manifest and finds a stopped admin-local unit', async () => {
  const source = await readFile(
    new URL('./retire-ollama-consumers.sh', import.meta.url),
    'utf8'
  );
  for (const root of [
    '/etc/systemd/system.control',
    '/run/systemd/system.control',
    '/run/systemd/transient',
    '/run/systemd/generator.early',
    '/etc/systemd/system',
    '/etc/systemd/system.attached',
    '/run/systemd/system',
    '/run/systemd/system.attached',
    '/run/systemd/generator',
    '/usr/local/lib/systemd/system',
    '/usr/lib/systemd/system',
    '/lib/systemd/system',
    '/run/systemd/generator.late',
  ])
    assert.match(
      source,
      new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-admin-local-'))
  );
  const root = join(directory, 'admin-local');
  const definition = join(root, 'stopped-admin.service');
  try {
    await mkdir(root);
    await writeFile(
      definition,
      '[Service]\nEnvironment=OLLAMA_HOST=http://127.0.0.1:11434\n'
    );
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}getent() { return 2; }; systemctl() { return 0; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
      'retire-ollama-admin-local-test',
      script.pathname,
      root,
    ]);
    assert.match(
      stdout,
      new RegExp(
        `^${definition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`,
        'm'
      )
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
