import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { canonicalJson } from './canonical-json.mjs';
import {
  installDockerStub,
  installStatStub,
} from './running-container-fixture.mjs';
import { createSourceArchive } from './source-archive.mjs';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const imageId = `sha256:${'c'.repeat(64)}`;
const projectorSourceSha = 'b'.repeat(40);
const projector = new URL(
  './retire-ollama-image-filesystem.pl',
  import.meta.url
);
const projectorAuth = new URL(
  './retire-ollama-projector-auth.sh',
  import.meta.url
);
const digest = (value) => createHash('sha256').update(value).digest('hex');

async function projectorAuthorityFixture(directory) {
  const sourceRoot = join(directory, 'source');
  const receiptRoot = join(directory, 'receipts');
  const sourceDirectory = join(sourceRoot, projectorSourceSha);
  const receiptDirectory = join(receiptRoot, projectorSourceSha);
  const projectorPath = join(
    sourceDirectory,
    'retire-ollama-image-filesystem.pl'
  );
  const projectorBytes = await readFile(projector);
  const manifest = {
    authority: {
      deploymentMarker: 'merged-test',
      deploymentRunAttempt: 1,
      deploymentRunId: 1,
      implementationBaseSha: 'd'.repeat(40),
      normativeContractPath: 'infra/cwv-runner/policy.json',
      normativeContractSha256: 'e'.repeat(64),
    },
    baseSha: 'f'.repeat(40),
    entries: [],
    mergeSha: projectorSourceSha,
    policyCanonicalSha256: '1'.repeat(64),
    policyFileSha256: '2'.repeat(64),
    prNumber: 1,
    reviewedHeadSha: projectorSourceSha,
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
    archiveSha256: 'b'.repeat(64),
    manifestSha256: manifestSha,
    schemaVersion: 1,
    sealedTreeSha256: 'c'.repeat(64),
    sourceSha: projectorSourceSha,
  };
  await mkdir(sourceDirectory, { mode: 0o700, recursive: true });
  await mkdir(receiptDirectory, { mode: 0o700, recursive: true });
  await chmod(sourceRoot, 0o700);
  await chmod(receiptRoot, 0o700);
  await writeFile(projectorPath, projectorBytes, { mode: 0o644 });
  await writeFile(
    join(sourceDirectory, 'retire-ollama-projector-auth.sh'),
    await readFile(projectorAuth),
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

function imageArchive() {
  const layers = [
    gzipSync(
      createSourceArchive([
        {
          bytes: Buffer.from('ollama from a historical layer'),
          mode: '100644',
          path: 'etc/service.conf',
        },
      ])
    ),
    gzipSync(
      createSourceArchive([
        {
          bytes: Buffer.alloc(0),
          mode: '100644',
          path: 'etc/.wh.service.conf',
        },
      ])
    ),
  ];
  return createSourceArchive([
    ...layers.map((bytes, index) => ({
      bytes,
      mode: '100644',
      path: `layer-${index}.tar`,
    })),
    {
      bytes: Buffer.from(
        JSON.stringify([
          { Config: 'config.json', Layers: ['layer-0.tar', 'layer-1.tar'] },
        ])
      ),
      mode: '100644',
      path: 'manifest.json',
    },
  ]);
}

test('running_container_validate ignores a marker deleted by a later image whiteout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-running-merged-'));
  const image = join(directory, 'image.tar');
  const filesystem = join(directory, 'filesystem.tar');
  await writeFile(image, imageArchive(), { mode: 0o600 });
  await writeFile(
    filesystem,
    createSourceArchive([
      { bytes: Buffer.from('clean'), mode: '100644', path: 'etc/clean.conf' },
    ]),
    { mode: 0o600 }
  );
  try {
    const authority = await projectorAuthorityFixture(directory);
    const docker = `docker() { case "$*" in *'inspect -f {{.Name}} generic-api'*) printf '%s\\n' '/generic-api';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' true;; *'inspect -f {{.Image}} generic-api'*) printf '%s\\n' '${imageId}';; *'inspect -f {{json .Path}} generic-api'*) printf '%s\\n' '"/docker-entrypoint"';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *'inspect -f {{json .Args}} generic-api'*) printf '%s\\n' '[]';; *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '[]';; *'inspect -f {{json (index .Config "Healthcheck")}} generic-api'*) printf '%s\\n' null;; *'inspect -f {{json .Mounts}} generic-api'*) printf '%s\\n' '[]';; *'image save ${imageId}'*) cat "$BACI_FIXTURE_IMAGE";; *'container export generic-api'*) cat "$BACI_FIXTURE_FILESYSTEM";; *) return 2;; esac; };`;
    const command = `. "$1"; SCRIPT_DIR="$3"; export RETIRE_OLLAMA_TMPDIR="$2" RETIRE_OLLAMA_TEST_BIN="$4" RETIRE_OLLAMA_TEST_FSTYPE=apfs RETIRE_OLLAMA_PROJECTOR_TEST_SOURCE_ROOT="$5" RETIRE_OLLAMA_PROJECTOR_TEST_RECEIPT_ROOT="$6" RETIRE_OLLAMA_CONSUMER_SCANNER_HELPER="$7"; init_temp_root; sha() { /usr/bin/shasum -a 256 "$1" | /usr/bin/cut -c1-64; }; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; export BACI_FIXTURE_IMAGE='${image}' BACI_FIXTURE_FILESYSTEM='${filesystem}'; ${docker} load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'; printf validated`;
    const bin = authority.stat.slice(0, authority.stat.lastIndexOf('/'));
    await installDockerStub(bin, command);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      command,
      script.pathname.replace(/\.sh$/, '-test.sh'),
      script.pathname,
      directory,
      authority.sourceDirectory,
      authority.stat.slice(0, authority.stat.lastIndexOf('/')),
      authority.sourceRoot,
      authority.receiptRoot,
      join(new URL('.', script).pathname, 'retire-ollama-consumers.sh'),
    ]);
    assert.equal(stdout, 'validated');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('starts a fresh projector deadline after two image archive passes', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-running-projection-deadline-')
  );
  const image = join(directory, 'image.tar');
  const filesystem = join(directory, 'filesystem.tar');
  await writeFile(image, imageArchive(), { mode: 0o600 });
  await writeFile(
    filesystem,
    createSourceArchive([
      { bytes: Buffer.from('clean'), mode: '100644', path: 'etc/clean.conf' },
    ]),
    { mode: 0o600 }
  );
  try {
    const authority = await projectorAuthorityFixture(directory);
    const docker = `docker() { case "$*" in *'inspect -f {{.Name}} generic-api'*) printf '%s\\n' '/generic-api';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' true;; *'inspect -f {{.Image}} generic-api'*) printf '%s\\n' '${imageId}';; *'inspect -f {{json .Path}} generic-api'*) printf '%s\\n' '"/docker-entrypoint"';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *'inspect -f {{json .Args}} generic-api'*) printf '%s\\n' '[]';; *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '[]';; *'inspect -f {{json (index .Config "Healthcheck")}} generic-api'*) printf '%s\\n' null;; *'inspect -f {{json .Mounts}} generic-api'*) printf '%s\\n' '[]';; *'image save ${imageId}'*) sleep 1; cat "$BACI_FIXTURE_IMAGE";; *'container export generic-api'*) cat "$BACI_FIXTURE_FILESYSTEM";; *) return 2;; esac; };`;
    const command = `. "$1"; SCRIPT_DIR="$3"; export RETIRE_OLLAMA_TMPDIR="$2" RETIRE_OLLAMA_TEST_BIN="$4" RETIRE_OLLAMA_TEST_FSTYPE=apfs RETIRE_OLLAMA_PROJECTOR_TEST_SOURCE_ROOT="$5" RETIRE_OLLAMA_PROJECTOR_TEST_RECEIPT_ROOT="$6" RETIRE_OLLAMA_CONSUMER_SCANNER_HELPER="$7"; init_temp_root; sha() { /usr/bin/shasum -a 256 "$1" | /usr/bin/cut -c1-64; }; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; export BACI_FIXTURE_IMAGE='${image}' BACI_FIXTURE_FILESYSTEM='${filesystem}'; ${docker} load_consumer_scanners; phase="$2/projection-phase"; running_container_now() { [ -e "$phase" ] && printf 3 || printf 0; }; running_container_archive_save_bounded() { [ "$1" = image ] && cp "$BACI_FIXTURE_IMAGE" "$3" || cp "$BACI_FIXTURE_FILESYSTEM" "$3"; }; running_container_archive_hash_stream() { : >"$phase"; [ "$1" = image ] && sha "$BACI_FIXTURE_IMAGE" || sha "$BACI_FIXTURE_FILESYSTEM"; }; RUNNING_CONTAINER_IMAGE_SAVE_TIMEOUT_SECONDS=3; running_container_validate generic-api /generic-api 'stable-config'; printf validated`;
    await installDockerStub(
      authority.stat.slice(0, authority.stat.lastIndexOf('/')),
      command
    );
    const { stdout } = await execFileAsync('sh', [
      '-c',
      command,
      script.pathname.replace(/\.sh$/, '-test.sh'),
      script.pathname,
      directory,
      authority.sourceDirectory,
      authority.stat.slice(0, authority.stat.lastIndexOf('/')),
      authority.sourceRoot,
      authority.receiptRoot,
      join(new URL('.', script).pathname, 'retire-ollama-consumers.sh'),
    ]);
    assert.equal(stdout, 'validated');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
