import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const unprivilegedExecution =
  process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const containerId = '0123456789abcdef'.repeat(4);
const reviewedContainerId = 'f'.repeat(64);
const scannerHarness =
  'RETIRE_OLLAMA_TEST_FSTYPE=apfs; stat() { for last do :; done; case "$*" in *"-c %F"*) [ -d "$last" ] && printf "directory\\n" || printf "regular file\\n" ;; *"-c %d:%i:%f:%s:%u:%g:%a"*) printf "1:2:81a4:10:501:20:644\\n" ;; *"-c %d"*) printf "1\\n" ;; *"-c %s"*) wc -c <"$last" | tr -d " " ;; *) printf "1:2:81a4:10:501:20:644\\n" ;; esac; }; findmnt() { printf "/ fixture apfs ro\\n"; }; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all';
test('refuses a consumer-scanner override from a privileged invocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-ollama-loader-root-'));
  const override = join(directory, 'override.sh');
  try {
    await writeFile(
      override,
      'scan_nginx_definitions() { printf override; }\n'
    );
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          'id() { printf "0\\n"; }; . "$1"; init_temp_root; trap cleanup_temp EXIT; RETIRE_OLLAMA_CONSUMER_SCANNER_HELPER="$2"; load_consumer_scanners',
          'retire-ollama-loader-root-test',
          script.pathname,
          override,
        ],
        {
          env: {
            ...process.env,
            RETIRE_OLLAMA_TMPDIR: directory,
            RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
            RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
          },
        }
      ),
      (error) =>
        error.code === 65 &&
        /privileged consumer scanner override refused/.test(error.stderr) &&
        error.stdout === ''
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('permits a test-only scanner override for an unprivileged harness', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-ollama-loader-test-'));
  const bin = join(directory, 'bin');
  const override = join(directory, 'override.sh');
  try {
    await mkdir(bin);
    await writeFile(
      override,
      'scan_nginx_definitions() { printf test-override; }\n'
    );
    await Promise.all([chmod(bin, 0o755), chmod(override, 0o644)]);
    await chmod(directory, 0o755);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        '. "$1"; init_temp_root; trap cleanup_temp EXIT; RETIRE_OLLAMA_CONSUMER_SCANNER_HELPER="$2"; scan_nginx_definitions',
        'retire-ollama-loader-test',
        script.pathname,
        override,
      ],
      {
        ...unprivilegedExecution,
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: bin,
          RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        },
      }
    );
    assert.equal(stdout, 'test-override');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('refuses an unprivileged scanner override outside the test harness', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-ollama-loader-user-'));
  const override = join(directory, 'override.sh');
  try {
    await writeFile(override, 'scan_nginx_definitions() { :; }\n');
    await Promise.all([chmod(override, 0o644), chmod(directory, 0o755)]);
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          'RETIRE_OLLAMA_TEST_BIN=/usr/bin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; unset RETIRE_OLLAMA_TEST_BIN; trap cleanup_temp EXIT; RETIRE_OLLAMA_CONSUMER_SCANNER_HELPER="$2"; load_consumer_scanners',
          'retire-ollama-loader-user-test',
          script.pathname,
          override,
        ],
        {
          ...unprivilegedExecution,
          env: {
            ...process.env,
            RETIRE_OLLAMA_TMPDIR: directory,
            RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
          },
        }
      ),
      (error) => error.code === 65 && /test harness/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('detects a stopped generic container consuming Ollama through a bind file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bind-file-'));
  const bin = join(directory, 'bin');
  const config = join(directory, 'runtime.env');
  try {
    await mkdir(bin);
    await writeFile(config, 'OLLAMA_HOST=http://127.0.0.1:11434\n');
    const canonicalConfig = await realpath(config);
    await writeFile(
      join(bin, 'docker'),
      `#!/bin/sh
case "$*" in
  *' ps -a '*) printf '${containerId}\\n' ;;
  *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;;
  *'{{.Id}}'*) printf '${containerId} /generic-api /bin/true [] [] "" {} null [{"Type":"bind","Source":"${canonicalConfig}","Destination":"/app/runtime.env"}] {} {} {} [] "bridge"\\n' ;;
  *'{{json .Mounts}}'*) printf '[{"Type":"bind","Source":"${canonicalConfig}","Destination":"/app/runtime.env"}]\\n' ;;
  *'{{json .State.Running}}'*) printf 'false\\n' ;;
  *' cp '*':/bin/true '*) destination=$5; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;;
esac
`
    );
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(config, 0o644),
      chmod(directory, 0o755),
    ]);
    const { stdout } = await execFileAsync(
      'sh',
      ['-c', scannerHarness, 'retire-ollama-bind-file-test', script.pathname],
      {
        ...unprivilegedExecution,
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: bin,
        },
      }
    );
    assert.match(stdout, new RegExp(`container-bind-mount:${containerId}:`));
    const outputWithLegacyId = stdout.replaceAll(containerId, 'generic-api');
    assert.match(
      outputWithLegacyId,
      new RegExp(
        `container-bind-mount:generic-api:/app/runtime\\.env\\|${canonicalConfig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|[0-9a-f]{64}\\|[0-9a-f]{64}`
      )
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('does not emit a blank consumer record for a nonmatching regular bind file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bind-blank-'));
  const bin = join(directory, 'bin');
  const config = join(directory, 'runtime.env');
  try {
    await mkdir(bin);
    await writeFile(config, 'OTHER_SERVICE=http://127.0.0.1:8080\n');
    const canonicalConfig = await realpath(config);
    await writeFile(
      join(bin, 'docker'),
      `#!/bin/sh
case "$*" in
  *' ps -a '*) printf '${containerId}\\n' ;;
  *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;;
  *'{{.Id}}'*) printf '${containerId} /generic-api /bin/true [] [] "" {} null [{"Type":"bind","Source":"${canonicalConfig}","Destination":"/app/runtime.env"}] {} {} {} [] "bridge"\\n' ;;
  *'{{json .Mounts}}'*) printf '[{"Type":"bind","Source":"${canonicalConfig}","Destination":"/app/runtime.env"}]\\n' ;;
  *'{{json .State.Running}}'*) printf 'false\\n' ;;
  *' cp '*':/bin/true '*) destination=$5; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;;
esac
`
    );
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(config, 0o644),
      chmod(directory, 0o755),
    ]);
    const { stdout } = await execFileAsync(
      'sh',
      ['-c', scannerHarness, 'retire-ollama-bind-blank-test', script.pathname],
      {
        ...unprivilegedExecution,
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: bin,
        },
      }
    );
    assert.equal(stdout, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('excludes the reviewed Ollama container and its bind file from consumer output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bind-target-'));
  const bin = join(directory, 'bin');
  const config = join(directory, 'runtime.env');
  try {
    await mkdir(bin);
    await writeFile(config, 'OLLAMA_HOST=http://127.0.0.1:11434\n');
    const canonicalConfig = await realpath(config);
    await writeFile(
      join(bin, 'docker'),
      `#!/bin/sh
case "$*" in
  *' ps -a '*) printf '${reviewedContainerId}\\n' ;;
  *'inspect -f {{.Name}} ${reviewedContainerId}') printf '/ollama-loopback\\n' ;;
  *'{{.Id}}'*) printf '${reviewedContainerId} /ollama-loopback /bin/true [] [] "" {} null [{"Type":"bind","Source":"${canonicalConfig}","Destination":"/app/runtime.env"}] {} {} {} [] "bridge"\\n' ;;
  *'{{json .Mounts}}'*) printf '[{"Type":"bind","Source":"${canonicalConfig}","Destination":"/app/runtime.env"}]\\n' ;;
esac
`
    );
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(config, 0o644),
      chmod(directory, 0o755),
    ]);
    const { stdout } = await execFileAsync(
      'sh',
      ['-c', scannerHarness, 'retire-ollama-bind-target-test', script.pathname],
      {
        ...unprivilegedExecution,
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: bin,
        },
      }
    );
    assert.equal(stdout, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('fails closed for a directory bind mount that cannot be a config source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bind-directory-'));
  const bin = join(directory, 'bin');
  const source = join(directory, 'config-directory');
  try {
    await Promise.all([mkdir(bin), mkdir(source)]);
    const canonicalSource = await realpath(source);
    await writeFile(
      join(bin, 'docker'),
      `#!/bin/sh
case "$*" in
  *' ps -a '*) printf '${containerId}\\n' ;;
  *'{{.Id}}'*) printf '${containerId} generic/app [] [] [{"Type":"bind","Source":"${canonicalSource}","Destination":"/app/config"}] {} {} {} [] "bridge"\\n' ;;
  *'{{json .Mounts}}'*) printf '[{"Type":"bind","Source":"${canonicalSource}","Destination":"/app/config"}]\\n' ;;
esac
`
    );
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(directory, 0o755),
    ]);
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          scannerHarness,
          'retire-ollama-bind-directory-test',
          script.pathname,
        ],
        {
          ...unprivilegedExecution,
          env: {
            ...process.env,
            RETIRE_OLLAMA_TEST_BIN: bin,
          },
        }
      ),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
