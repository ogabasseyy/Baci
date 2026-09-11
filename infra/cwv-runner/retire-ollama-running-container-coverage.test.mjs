import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import {
  installDockerStub,
  installStatStub,
} from './running-container-fixture.mjs';

const execFileAsync = promisify(execFile);
const running = new URL(
  './retire-ollama-running-container.sh',
  import.meta.url
);
const projector = new URL(
  './retire-ollama-image-filesystem.pl',
  import.meta.url
);
const projectorAuth = new URL(
  './retire-ollama-projector-auth.sh',
  import.meta.url
);
const loader = new URL('./retire-ollama-source-loader.sh', import.meta.url);
const main = new URL('./retire-ollama.sh', import.meta.url);
const sourceSha = 'a'.repeat(40);
const imageId = `sha256:${'b'.repeat(64)}`;
const containerId = 'c'.repeat(64);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('extracts the complete Docker fixture when its body has nested braces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-running-fixture-'));
  try {
    const docker = join(directory, 'docker');
    const command =
      'docker() { case "$1" in nested) helper() { printf nested; }; helper;; *) printf fallback;; esac; }; load_consumer_scanners;';
    await installDockerStub(directory, command);
    const { stdout } = await execFileAsync(docker, ['nested'], {
      env: { ...process.env, RETIRE_OLLAMA_TMPDIR: directory },
    });
    assert.equal(stdout, 'nested');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

async function authorityFixture(directory) {
  const sourceRoot = join(directory, 'source');
  const receiptRoot = join(directory, 'receipts');
  const sourceDirectory = join(sourceRoot, sourceSha);
  const receiptDirectory = join(receiptRoot, sourceSha);
  const projectorBytes = await readFile(projector);
  const manifest = {
    authority: {
      deploymentMarker: 'coverage-test',
      deploymentRunAttempt: 1,
      deploymentRunId: 1,
      implementationBaseSha: 'c'.repeat(40),
      normativeContractPath: 'infra/cwv-runner/policy.json',
      normativeContractSha256: 'd'.repeat(64),
    },
    baseSha: 'e'.repeat(40),
    entries: [],
    mergeSha: sourceSha,
    policyCanonicalSha256: '1'.repeat(64),
    policyFileSha256: '2'.repeat(64),
    prNumber: 1,
    reviewedHeadSha: sourceSha,
    schemaVersion: 1,
    sourceArchive: {
      entries: [
        {
          blobSha256: digest(projectorBytes),
          mode: '100644',
          path: 'infra/cwv-runner/retire-ollama-image-filesystem.pl',
        },
      ],
      prefix: 'infra/cwv-runner/',
    },
  };
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const manifestSha = digest(manifestBytes);
  const seal = {
    archiveSha256: '3'.repeat(64),
    manifestSha256: manifestSha,
    schemaVersion: 1,
    sealedTreeSha256: '4'.repeat(64),
    sourceSha,
  };
  await mkdir(sourceDirectory, { mode: 0o700, recursive: true });
  await mkdir(receiptDirectory, { mode: 0o700, recursive: true });
  await chmod(sourceRoot, 0o700);
  await chmod(receiptRoot, 0o700);
  await writeFile(
    join(sourceDirectory, 'retire-ollama-image-filesystem.pl'),
    projectorBytes,
    { mode: 0o644 }
  );
  await writeFile(
    join(sourceDirectory, 'retire-ollama-projector-auth.sh'),
    await readFile(projectorAuth),
    { mode: 0o644 }
  );
  await writeFile(
    join(sourceDirectory, 'retire-ollama-running-container-validation.sh'),
    await readFile(
      new URL(
        './retire-ollama-running-container-validation.sh',
        import.meta.url
      )
    ),
    { mode: 0o644 }
  );
  await writeFile(join(receiptDirectory, 'manifest.json'), manifestBytes, {
    mode: 0o600,
  });
  await writeFile(
    join(receiptDirectory, 'manifest.sha256'),
    `${manifestSha}\n`,
    { mode: 0o600 }
  );
  await writeFile(
    join(receiptDirectory, 'seal-receipt.json'),
    `${canonicalJson(seal)}\n`,
    { mode: 0o600 }
  );
  const stat = join(directory, 'stat');
  await installStatStub(stat);
  return { sourceDirectory, sourceRoot, receiptRoot, stat };
}

async function runDeadlineProbe(directory, authority) {
  const toolRoot = dirname(authority.stat);
  const command = `. "${loader.pathname}"; SCRIPT_DIR="$3"; RETIRE_OLLAMA_TEST_BIN="$6"; RETIRE_OLLAMA_PROJECTOR_TEST_SOURCE_ROOT="$4"; RETIRE_OLLAMA_PROJECTOR_TEST_RECEIPT_ROOT="$5"; . "$1"; probe_counter="$2/now-count"; running_container_now() { count=$(cat "$probe_counter" 2>/dev/null || printf 0); printf '%s\\n' "$((count + 1))" >"$probe_counter"; printf 5; }; probe="$2/probe.tar"; : >"$probe"; for deadline in '' abc 5; do if running_container_image_matches_merged "$probe" "$deadline"; then exit 10; else status=$?; [ "$status" -eq 2 ] || exit 11; fi; done; [ "$(cat "$probe_counter")" = 1 ] || exit 12; printf ok`;
  const { stdout } = await execFileAsync('sh', [
    '-c',
    command,
    'deadline-probe',
    running.pathname,
    directory,
    authority.sourceDirectory,
    authority.sourceRoot,
    authority.receiptRoot,
    toolRoot,
  ]);
  return stdout.trim();
}

async function runProjectionFailure(directory, authority) {
  const toolRoot = dirname(authority.stat);
  const image = join(directory, 'invalid-image.tar');
  const filesystem = join(directory, 'filesystem.tar');
  await writeFile(image, 'not-a-tar', { mode: 0o600 });
  await writeFile(filesystem, 'clean filesystem', { mode: 0o600 });
  const socketPrelude = `test() { if [ "$1" = -S ]; then case "$2" in /run/docker.sock|/var/run/docker.sock) return 0;; *) return 1;; esac; fi; /usr/bin/test "$@"; }; stat() { case "$*" in *"%u:%a"*"/run/docker.sock"|*"%u:%a"*"/var/run/docker.sock") printf '0:660\\n';; *"/run/docker.sock"|*"/var/run/docker.sock") printf '1:2:14000:0:999:660\\n';; *) /usr/bin/stat "$@";; esac; }; readlink() { if [ "$1" = -f ]; then path=$2; [ "$path" = -- ] && path=$3; case "$path" in /run/docker.sock|/var/run/docker.sock) printf '/run/docker.sock\\n';; *) /usr/bin/readlink "$@";; esac; else /usr/bin/readlink "$@"; fi; };`;
  const docker = `docker() { case "$*" in *'inspect -f {{.Name}} ${containerId}'*) printf '%s\\n' '/generic-api';; *'inspect -f {{json .State.Running}} ${containerId}'*) printf '%s\\n' true;; *'inspect -f {{.Image}} ${containerId}'*) printf '%s\\n' '${imageId}';; *'inspect -f {{json .Path}} ${containerId}'*) printf '%s\\n' '"/docker-entrypoint"';; *'inspect -f {{json .Config.WorkingDir}} ${containerId}'*) printf '%s\\n' '""';; *'inspect -f {{json .Args}} ${containerId}'*) printf '%s\\n' '[]';; *'inspect -f {{json .Config.Env}} ${containerId}'*) printf '%s\\n' '["DOCKER_SOCK=/var/run/docker.sock"]';; *'inspect -f {{json (index .Config "Healthcheck")}} ${containerId}'*) printf '%s\\n' null;; *'inspect -f {{json .Mounts}} ${containerId}'*) printf '%s\\n' '[{"Type":"bind","Source":"/var/run/docker.sock","Destination":"/var/run/docker.sock"}]';; *) return 2;; esac; };`;
  const command = `. "$1"; SCRIPT_DIR=$(dirname "$1"); export RETIRE_OLLAMA_TMPDIR="$2"; RETIRE_OLLAMA_TEST_BIN="$3"; RETIRE_OLLAMA_TEST_FSTYPE=apfs; RETIRE_OLLAMA_PROJECTOR_TEST_SOURCE_ROOT="$4"; RETIRE_OLLAMA_PROJECTOR_TEST_RECEIPT_ROOT="$5"; RETIRE_OLLAMA_CONSUMER_SCANNER_HELPER="$6"; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; ${socketPrelude} ${docker} load_consumer_scanners; running_container_now() { printf 0; }; running_container_archive_save_bounded() { case "$1" in image) /bin/cp "$BACI_FIXTURE_IMAGE" "$3";; container) /bin/cp "$BACI_FIXTURE_FILESYSTEM" "$3";; *) return 2;; esac; : >"$5"; }; running_container_archive_hash_stream() { case "$1" in image) /usr/bin/shasum -a 256 "$BACI_FIXTURE_IMAGE" | /usr/bin/awk '{print $1}';; container) /usr/bin/shasum -a 256 "$BACI_FIXTURE_FILESYSTEM" | /usr/bin/awk '{print $1}';; *) return 2;; esac; }; diagnostic=$(temp_path); CONTAINER_SCAN_DIAGNOSTIC_FILE="$diagnostic"; export BACI_FIXTURE_IMAGE="$7" BACI_FIXTURE_FILESYSTEM="$8"; if running_container_validate "$9" /generic-api stable-config; then exit 12; else status=$?; fi; printf '%s:%s\\n' "$status" "$(cat "$diagnostic")"`;
  await installDockerStub(toolRoot, command);
  const { stdout } = await execFileAsync('sh', [
    '-c',
    command,
    'projection-diagnostic',
    main.pathname,
    directory,
    toolRoot,
    authority.sourceRoot,
    authority.receiptRoot,
    join(new URL('.', running).pathname, 'retire-ollama-consumers.sh'),
    image,
    filesystem,
    containerId,
  ]);
  return stdout.trim();
}

test('rejects invalid and expired projection deadlines with status two', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-running-deadline-'));
  try {
    const marker = join(directory, 'unexpected-command-execution');
    const fixtureDirectory = join(directory, `fixture"$(touch ${marker})`);
    await mkdir(fixtureDirectory, { recursive: true });
    const authority = await authorityFixture(fixtureDirectory);
    const target = join(directory, 'stat-target');
    const link = join(directory, 'stat-link');
    await writeFile(target, 'target', { mode: 0o640 });
    await symlink(target, link);
    const formats = await Promise.all([
      execFileAsync(authority.stat, ['-c', '%u:%a', '--', target]),
      execFileAsync(authority.stat, ['-Lc', '%u:%a', '--', target]),
      execFileAsync(authority.stat, ['--format=%u:%a', '--', target]),
    ]);
    assert.deepEqual(
      formats.map(({ stdout }) => stdout.trim()),
      [
        `${process.getuid()}:640`,
        `${process.getuid()}:640`,
        `${process.getuid()}:640`,
      ]
    );
    const [linkInode, followedInode] = await Promise.all([
      execFileAsync(authority.stat, ['-c', '%i', '--', link]),
      execFileAsync(authority.stat, ['-L', '-c', '%i', '--', link]),
    ]);
    assert.notEqual(linkInode.stdout.trim(), followedInode.stdout.trim());
    assert.equal(await runDeadlineProbe(fixtureDirectory, authority), 'ok');
    await assert.rejects(readFile(marker));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('records image-projection when the real projector rejects an archive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-running-projection-'));
  try {
    const authority = await authorityFixture(directory);
    assert.equal(
      await runProjectionFailure(directory, authority),
      '2:image-projection'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
