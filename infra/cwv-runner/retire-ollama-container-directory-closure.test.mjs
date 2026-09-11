import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
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
const portableFilesystem = `
sha256sum() { /usr/bin/shasum -a 256 "$@"; }
stat() {
  for last do :; done
  case "$*" in
    *'-c %F'*) [ -d "$last" ] && printf 'directory\\n' || printf 'regular file\\n' ;;
    *'-c %d:%i:%f:%s:%u:%g:%a'*) printf '1:2:81a4:10:0:0:600\\n' ;;
    *'-c %d'*) printf '1\\n' ;;
    *'-c %s'*) wc -c <"$last" | tr -d ' ' ;;
    *) printf '1:2:81a4:10:0:0:600\\n' ;;
  esac
}
findmnt() { printf '/ fixture apfs ro\\n'; }
`;

test('traverses a stopped container directory-valued environment path', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-environment-directory-'))
  );
  try {
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${portableFilesystem}
docker() {
  case "$*" in
    *'inspect -f {{json .Config.Env}} generic-api') printf '["CONFIG=/etc/application"]\\n' ;;
    *'inspect -f {{json .Config.WorkingDir}} generic-api') printf '""\\n' ;;
    *'inspect -f {{json .State.Running}} generic-api') printf 'false\\n' ;;
    *'cp generic-api:/etc/application '*) for destination do :; done; mkdir "$destination"; printf 'endpoint=http://127.0.0.1:11434\\n' >"$destination/application.conf" ;;
    *) return 2 ;;
  esac
}
. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; container_environment_consumers generic-api '["CONFIG=/etc/application"]'`,
      'retire-ollama-container-environment-directory-test',
      script.pathname,
      directory,
    ]);

    assert.match(
      stdout,
      /^container-bind-directory:generic-api:\/etc\/application\|/m
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('accepts zero-byte regular files in a bind directory', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-bind-empty-file-'))
  );
  try {
    await writeFile(join(directory, 'empty.conf'), '');
    const emptyFileFilesystem = portableFilesystem.replace(
      "[ -d \"$last\" ] && printf 'directory\\n' || printf 'regular file\\n'",
      "[ -d \"$last\" ] && printf 'directory\\n' || printf 'regular empty file\\n'"
    );
    const { stdout, stderr } = await execFileAsync('sh', [
      '-c',
      `${emptyFileFilesystem}
. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; output=$(temp_path); container_bind_directory_snapshot "$3" "$output"; cat "$output"`,
      'retire-ollama-container-bind-empty-file-test',
      script.pathname,
      directory,
      directory,
    ]);
    assert.match(
      stdout,
      new RegExp(`${join(directory, 'empty.conf').replaceAll('/', '\\/')}\\|`)
    );
    assert.equal(stderr, '');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed when find emits a partial bind inventory then fails', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-bind-find-failure-'))
  );
  try {
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${portableFilesystem}
find() { case "$*" in *'-name '*) return 0;; *) printf '%s\\n' "$3"; return 2;; esac; }
. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; output=$(temp_path); if container_bind_directory_snapshot "$3" "$output"; then exit 5; else status=$?; fi; [ "$status" -eq 2 ] && [ ! -e "$output" ] || exit 4; exit 2`,
        'retire-ollama-container-bind-find-failure-test',
        script.pathname,
        directory,
        directory,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

for (const unsafeName of ['line\nbreak.conf', 'pipe|name.conf']) {
  test(`fails closed for a bind path containing ${JSON.stringify(unsafeName)}`, async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'baci-container-bind-delimiter-'))
    );
    try {
      await writeFile(
        join(directory, unsafeName),
        'endpoint=http://127.0.0.1:11434\n'
      );
      await assert.rejects(
        execFileAsync('sh', [
          '-c',
          `${portableFilesystem}
. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; output=$(temp_path); if container_bind_directory_snapshot "$3" "$output"; then exit 5; else status=$?; fi; [ "$status" -eq 2 ] && [ ! -e "$output" ] || exit 4; exit 2`,
          'retire-ollama-container-bind-delimiter-test',
          script.pathname,
          directory,
          directory,
        ]),
        (error) => error.code === 2
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
}

test('binds a Let’s Encrypt-style relative certificate symlink within the mounted tree', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-bind-letsencrypt-'))
  );
  const mounted = join(directory, 'letsencrypt');
  const archive = join(mounted, 'archive', 'api.example');
  const live = join(mounted, 'live', 'api.example');
  try {
    await mkdir(archive, { recursive: true });
    await mkdir(live, { recursive: true });
    const certificate = join(archive, 'cert1.pem');
    const link = join(live, 'cert.pem');
    await writeFile(certificate, 'endpoint=http://127.0.0.1:11434\n');
    await symlink('../../archive/api.example/cert1.pem', link);

    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${portableFilesystem}
. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; output=$(temp_path); container_bind_directory_snapshot "$3" "$output"; cat "$output"; container_bind_directory_consumers generic-api "$3" /etc/letsencrypt`,
      'retire-ollama-container-bind-letsencrypt-test',
      script.pathname,
      directory,
      mounted,
    ]);

    assert.match(
      stdout,
      new RegExp(`^@link:${link.replaceAll('/', '\\/')}\\|`, 'm')
    );
    assert.match(
      stdout,
      new RegExp(`^${certificate.replaceAll('/', '\\/')}\\|`, 'm')
    );
    assert.match(
      stdout,
      /^container-bind-directory:generic-api:\/etc\/letsencrypt\|/m
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('records a marker-bearing Certbot symlink as sanitized consumer evidence', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-bind-marker-symlink-'))
  );
  try {
    const source = join(directory, 'letsencrypt');
    const archive = join(source, 'archive', 'ollama.usebaci.com');
    const live = join(source, 'live', 'ollama.usebaci.com');
    await mkdir(archive, { recursive: true });
    await mkdir(live, { recursive: true });
    await writeFile(join(archive, 'cert3.pem'), 'certificate bytes\n');
    await symlink(
      '../../archive/ollama.usebaci.com/cert3.pem',
      join(live, 'cert.pem')
    );

    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${portableFilesystem}
. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT HUP INT TERM; if container_bind_directory_consumers generic-api "$3" /etc/letsencrypt; then status=0; else status=$?; fi; [ "$status" -eq 0 ] || exit "$status"`,
      'retire-ollama-container-bind-marker-symlink-test',
      script.pathname,
      directory,
      source,
    ]);

    assert.match(
      stdout,
      /^container-bind-directory-link:[a-f0-9]{64}:[a-f0-9]{64}\|[a-f0-9]{64}\n?$/
    );
    assert.doesNotMatch(stdout, /ollama\.usebaci\.com|cert3\.pem/);

    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${portableFilesystem}
. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; grep() { return 2; }; output=$(temp_path); if container_bind_directory_snapshot "$3" "$output"; then exit 5; else status=$?; fi; [ "$status" -eq 2 ] && [ ! -e "$output" ] || exit 4; exit 2`,
        'retire-ollama-container-bind-marker-grep-failure-test',
        script.pathname,
        directory,
        source,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed for a relative bind-tree symlink that escapes the mounted tree', async () => {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-bind-symlink-escape-'))
  );
  const directory = join(parent, 'mounted');
  try {
    await mkdir(directory);
    await writeFile(join(parent, 'outside.conf'), 'clean\n');
    await symlink('../outside.conf', join(directory, 'escape.conf'));

    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${portableFilesystem}
. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; output=$(temp_path); container_bind_directory_snapshot "$3" "$output"`,
        'retire-ollama-container-bind-symlink-escape-test',
        script.pathname,
        parent,
        directory,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test('fails closed when an internal bind-tree symlink changes between snapshots', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-bind-symlink-drift-'))
  );
  const mounted = join(directory, 'letsencrypt');
  const archive = join(mounted, 'archive', 'api.example');
  const live = join(mounted, 'live', 'api.example');
  try {
    await mkdir(archive, { recursive: true });
    await mkdir(live, { recursive: true });
    await writeFile(join(archive, 'cert1.pem'), 'first\n');
    await writeFile(join(archive, 'cert2.pem'), 'second\n');
    await symlink(
      '../../archive/api.example/cert1.pem',
      join(live, 'cert.pem')
    );

    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${portableFilesystem}
. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; mutation_root=$3; consumer_matched_fingerprint() { if [ ! -e "$mutation_root/mutated" ]; then rm "$mutation_root/letsencrypt/live/api.example/cert.pem"; ln -s ../../archive/api.example/cert2.pem "$mutation_root/letsencrypt/live/api.example/cert.pem"; : >"$mutation_root/mutated"; fi; return 1; }; container_bind_directory_consumers generic-api "$3/letsencrypt" /etc/letsencrypt`,
        'retire-ollama-container-bind-symlink-drift-test',
        script.pathname,
        directory,
        directory,
      ])
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
