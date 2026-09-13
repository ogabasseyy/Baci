import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  chown,
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
import { createSourceArchive } from './source-archive.mjs';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const imageId = `sha256:${'a'.repeat(64)}`;
const projectorSourceSha = 'a'.repeat(40);
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
      deploymentMarker: 'autoheal-test',
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
  const bin = join(directory, 'bin');
  await mkdir(bin, { mode: 0o700, recursive: true });
  await writeFile(
    join(bin, 'docker'),
    '#!/bin/sh\ncase "$*" in *\x27 image save \x27*) /bin/cat "$(dirname "$0")/../image.tar";; *\x27 container export \x27*) printf \x27%s\\n\x27 \x27clean live filesystem\x27;; *) exit 2;; esac\n',
    { mode: 0o755 }
  );
  const stat = join(bin, 'stat');
  await writeFile(
    stat,
    '#!' +
      process.execPath +
      "\nconst fs=require('node:fs');const a=process.argv.slice(2),i=a.findIndex(v=>v==='-c'||v==='--format'||/^-.*c$/.test(v)),f=i>=0?a[i+1]:a.find(v=>v.startsWith('--format='))?.slice(9),p=a.at(-1),follow=a.includes('-L')||a.includes('-Lc'),s=(follow?fs.statSync:fs.lstatSync)(p),m=s.mode&0o777;const type=(s.mode&0o170000)===0o040000?'directory':(s.mode&0o170000)===0o100000?'regular file':'unknown',r=(f??'%a');if(!/^(?:%[difuFgash]|[^%])+$/.test(r))process.exit(2);process.stdout.write(r.replaceAll('%d',String(s.dev)).replaceAll('%i',String(s.ino)).replaceAll('%f',(s.mode>>>0).toString(16)).replaceAll('%F',type).replaceAll('%u',String(s.uid)).replaceAll('%g',String(s.gid)).replaceAll('%a',m.toString(8)).replaceAll('%h',String(s.nlink)).replaceAll('%s',String(s.size))+'\\n');\n",
    { mode: 0o755 }
  );
  if (unprivileged.uid !== undefined && unprivileged.gid !== undefined) {
    await Promise.all(
      [
        directory,
        sourceRoot,
        sourceDirectory,
        projectorPath,
        join(sourceDirectory, 'retire-ollama-projector-auth.sh'),
        receiptRoot,
        receiptDirectory,
        join(receiptDirectory, 'manifest.json'),
        join(receiptDirectory, 'manifest.sha256'),
        join(receiptDirectory, 'seal-receipt.json'),
        bin,
        join(bin, 'docker'),
        stat,
      ].map((path) => chown(path, unprivileged.uid, unprivileged.gid))
    );
  }
  return { sourceDirectory, sourceRoot, receiptRoot, stat };
}
function imageArchive() {
  const layer = gzipSync(
    createSourceArchive([
      {
        bytes: Buffer.from('ollama marker'),
        mode: '100644',
        path: 'etc/service.conf',
      },
    ])
  );
  return createSourceArchive([
    { bytes: layer, mode: '100644', path: 'layer-0.tar' },
    {
      bytes: Buffer.from(
        JSON.stringify([{ Config: 'config.json', Layers: ['layer-0.tar'] }])
      ),
      mode: '100644',
      path: 'manifest.json',
    },
  ]);
}

async function runFixture(command, withImage = false) {
  const dir = await mkdtemp(join(tmpdir(), 'baci-retire-ollama-autoheal-'));
  try {
    const authority = await projectorAuthorityFixture(dir);
    if (withImage) {
      const imagePath = join(dir, 'image.tar');
      await writeFile(imagePath, imageArchive(), { mode: 0o600 });
      if (unprivileged.uid !== undefined && unprivileged.gid !== undefined) {
        await chown(imagePath, unprivileged.uid, unprivileged.gid);
      }
    }
    const socketFixturePrelude = `test() { if [ "$1" = -S ]; then case "$2" in /run/docker.sock|/var/run/docker.sock) return 0 ;; *) return 1 ;; esac; fi; /usr/bin/test "$@"; }; stat() { case "$*" in *"%u:%a"*"/run/docker.sock"|*"%u:%a"*"/var/run/docker.sock") printf '0:660\\n' ;; *"/run/docker.sock"|*"/var/run/docker.sock") printf '1:2:14000:0:999:660\\n' ;; *) /usr/bin/stat "$@" ;; esac; }; readlink() { if [ "$1" = -f ]; then path=$2; [ "$path" = -- ] && path=$3; case "$path" in /run/docker.sock|/var/run/docker.sock) printf '/run/docker.sock\\n' ;; *) /usr/bin/readlink "$@" ;; esac; else /usr/bin/readlink "$@"; fi; };`;
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; SCRIPT_DIR="$3"; RETIRE_OLLAMA_TEST_BIN="$4"; RETIRE_OLLAMA_TEST_FSTYPE=apfs; RETIRE_OLLAMA_PROJECTOR_TEST_SOURCE_ROOT="$5"; RETIRE_OLLAMA_PROJECTOR_TEST_RECEIPT_ROOT="$6"; RETIRE_OLLAMA_CONSUMER_SCANNER_HELPER="$7"; sha() { /usr/bin/shasum -a 256 "$1" | /usr/bin/cut -c1-64; }; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; ${socketFixturePrelude} ${command}`,
      'fixture',
      script.pathname,
      dir,
      authority.sourceDirectory,
      authority.stat.slice(0, authority.stat.lastIndexOf('/')),
      authority.sourceRoot,
      authority.receiptRoot,
      join(new URL('.', script).pathname, 'retire-ollama-consumers.sh'),
    ]);
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test('ignores a stable canonical Docker socket bind instead of treating it as config', async () => {
  const output = await runFixture(
    `docker() { case "$*" in *'inspect -f {{json .Mounts}} generic-api'*) printf '%s\\n' '[{"Type":"bind","Source":"/var/run/docker.sock","Destination":"/var/run/docker.sock"}]';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' 'true';; *) return 2;; esac; }; load_consumer_scanners; container_bind_mount_consumers generic-api`
  );
  assert.match(
    output.trim(),
    /^container-docker-socket:[0-9a-f]{64}:[0-9a-f]{64}\|[0-9a-f]{64}\|[0-9a-f]{64}$/
  );
});
test('keeps canonical Docker socket audit rows out of consumer counts', async () => {
  const output = await runFixture(
    `docker() { case "$*" in *'inspect -f {{json .Mounts}} generic-api'*) printf '%s\\n' '[{"Type":"bind","Source":"/var/run/docker.sock","Destination":"/var/run/docker.sock"}]';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' 'true';; *) return 2;; esac; }; load_consumer_scanners; records='[]'; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; socket=$(temp_path); container_bind_mount_consumers generic-api >"$socket"; printf '%s\\n' 'container-bind-mount:generic-api:/etc/ollama' >>"$socket"; record_consumers container-definitions "$socket" all; printf '%s\\n%s\\n' "$(cat "$socket")" "$consumer_counts"`
  );
  const rows = output.trim().split('\n');
  assert.match(
    rows[0],
    /^container-docker-socket:[0-9a-f]{64}:[0-9a-f]{64}\|[0-9a-f]{64}\|[0-9a-f]{64}$/
  );
  assert.deepEqual(JSON.parse(rows.at(-1)), [
    { surface: 'container-definitions', matchCount: 1 },
  ]);
});
test('does not docker-cp runtime PATH or DOCKER_SOCK values from a running container', async () => {
  const output = await runFixture(
    `docker() { case "$*" in *'inspect -f {{json .Mounts}} generic-api'*) printf '%s\\n' '[{"Type":"bind","Source":"/var/run/docker.sock","Destination":"/var/run/docker.sock"}]';; *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '["PATH=/usr/bin:/bin","DOCKER_SOCK=/var/run/docker.sock"]';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' 'true';; *' cp '*) printf 'unexpected docker cp\\n' >&2; return 91;; *) return 2;; esac; }; load_consumer_scanners; container_environment_consumers generic-api 'generic-api /generic-api /usr/bin/application [] ["PATH=/usr/bin:/bin","DOCKER_SOCK=/var/run/docker.sock"] "" {} null [] {} {} {} [] "bridge"'`
  );
  assert.equal(output, '');
});
test('does not copy lexical Ollama metadata from a running container', async () => {
  const output = await runFixture(
    `docker() { case "$*" in *'inspect -f {{json .Mounts}} generic-api'*) printf '%s\\n' '[]';; *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '["PATH=/usr/bin:/bin","OLLAMA_HOST=http://127.0.0.1:11434"]';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' 'true';; *' cp '*) printf 'unexpected docker cp\\n' >&2; return 91;; *) return 2;; esac; }; load_consumer_scanners; container_environment_consumers generic-api 'generic-api /generic-api /usr/bin/application [] ["PATH=/usr/bin:/bin","OLLAMA_HOST=http://127.0.0.1:11434"] "" {} null [] {} {} {} [] "bridge"'`
  );
  assert.equal(output, '');
});
test('allows only canonical Docker socket environment values', async () => {
  for (const socket of ['/var/run/docker.sock', '/run/docker.sock']) {
    const output = await runFixture(
      `docker() { case "$*" in *'inspect -f {{json .Mounts}} generic-api'*) printf '%s\\n' '[{"Type":"bind","Source":"/var/run/docker.sock","Destination":"${socket}"}]';; *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '["DOCKER_SOCK=${socket}"]';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *' cp '*) return 91;; *) return 2;; esac; }; load_consumer_scanners; container_environment_consumers generic-api 'generic-api /generic-api /usr/bin/application [] ["DOCKER_SOCK=${socket}"] "" {} null [] {} {} {} [] "bridge"'`
    );
    assert.equal(output, '');
  }
  await assert.rejects(
    runFixture(
      `docker() { case "$*" in *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '["DOCKER_SOCK=/tmp/docker.sock"]';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' 'true';; *) return 2;; esac; }; load_consumer_scanners; container_environment_consumers generic-api 'generic-api /generic-api /usr/bin/application [] ["DOCKER_SOCK=/tmp/docker.sock"] "" {} null [] {} {} {} [] "bridge"'`
    ),
    (error) => error.code === 2
  );
  await assert.rejects(
    runFixture(
      `docker() { case "$*" in *'inspect -f {{json .Mounts}} generic-api'*) printf '%s\\n' '[]';; *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '["DOCKER_SOCK=/var/run/docker.sock"]';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *) return 2;; esac; }; load_consumer_scanners; container_environment_consumers generic-api 'generic-api /generic-api /usr/bin/application [] ["DOCKER_SOCK=/var/run/docker.sock"] "" {} null [] {} {} {} [] "bridge"'`
    ),
    (error) => error.code === 2
  );
});
test('does not let a duplicate PATH value hide a running config path', async () => {
  await assert.rejects(
    runFixture(
      `docker() { case "$*" in *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '["PATH=/etc/app.conf","CONFIG=/etc/app.conf"]';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' 'true';; *) return 2;; esac; }; load_consumer_scanners; container_environment_consumers generic-api 'generic-api /generic-api /usr/bin/application [] ["PATH=/etc/app.conf","CONFIG=/etc/app.conf"] "" {} null [] {} {} {} [] "bridge"'`
    ),
    (error) => error.code === 2
  );
});
test('excludes PATH before file-path validation', async () => {
  const output = await runFixture(
    `docker() { case "$*" in *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '["PATH=/usr/$UNEXPANDED/bin"]';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *' cp '*) return 91;; *) return 2;; esac; }; load_consumer_scanners; container_environment_consumers generic-api 'generic-api /generic-api /usr/bin/application [] ["PATH=/usr/$UNEXPANDED/bin"] "" {} null [] {} {} {} [] "bridge"'`
  );
  assert.equal(output, '');
});
test('propagates an unsafe environment result through the container snapshot', async () => {
  await assert.rejects(
    runFixture(
      `docker() { case "$*" in *'inspect -f {{.Name}} generic-api'*) printf '%s\\n' '/generic-api';; *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '["DOCKER_SOCK=/tmp/docker.sock"]';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' 'true';; *) return 2;; esac; }; load_consumer_scanners; container_configuration() { printf '%s\\n' 'generic-api /generic-api /usr/bin/application [] ["DOCKER_SOCK=/tmp/docker.sock"] "" {} null [] {} {} {} [] "bridge"'; }; container_configuration_network_mode() { :; }; container_bind_mount_consumers() { :; }; container_argument_consumers() { :; }; container_option_argument_consumers() { :; }; container_healthcheck_consumers() { :; }; raw=$(temp_path); printf '%s\\n' generic-api >"$raw"; scan_container_snapshot all "$raw"`
    ),
    (error) => error.code === 2
  );
});
test('accepts a running generic container with scalar metadata and immutable image evidence', async () => {
  const output = await runFixture(
    `image_archive="$2/image.tar"; docker() { case "$*" in *'inspect -f {{.Name}} generic-api'*) printf '%s\\n' '/generic-api';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' 'true';; *'inspect -f {{.Image}} generic-api'*) printf '%s\\n' '${imageId}';; *'inspect -f {{json .Path}} generic-api'*) printf '%s\\n' '"/docker-entrypoint"';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *'inspect -f {{json .Args}} generic-api'*) printf '%s\\n' '["--model","llama3.2:latest","--token","abc.def/ghi"]';; *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '["NODE_VERSION=22.14.0","MODEL=llama3.2:latest","TOKEN=abc.def/ghi","DOCKER_SOCK=/var/run/docker.sock"]';; *'inspect -f {{json (index .Config "Healthcheck")}} generic-api'*) printf '%s\\n' '{"Test":["CMD-SHELL","curl -fsS http://127.0.0.1:8080/health"]}';; *'inspect -f {{json .Mounts}} generic-api'*) printf '%s\\n' '[{"Type":"bind","Source":"/var/run/docker.sock","Destination":"/var/run/docker.sock"}]';; *'image save ${imageId}'*) cat "$image_archive";; *'container export generic-api'*) printf '%s\\n' 'clean live filesystem';; *' cp '*) printf 'unexpected docker cp\\n' >&2; return 91;; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'generic-api /generic-api /docker-entrypoint ["--model","llama3.2:latest","--token","abc.def/ghi"] ["NODE_VERSION=22.14.0","MODEL=llama3.2:latest","TOKEN=abc.def/ghi","DOCKER_SOCK=/var/run/docker.sock"] "" {} {"Test":["CMD-SHELL","curl -fsS http://127.0.0.1:8080/health"]} [] {} {} {} [] "bridge"'`,
    true
  );
  assert.match(
    output,
    /^running-container-image:[0-9a-f]{64}\|[0-9a-f]{64}\|[0-9a-f]{64}$/m
  );
  assert.doesNotMatch(
    output,
    /abc\.def\/ghi|NODE_VERSION|image filesystem|11434|127\.0\.0\.1/
  );
});

test('fixture stat accepts combined -L and -c options', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-retire-ollama-autoheal-stat-')
  );
  try {
    const authority = await projectorAuthorityFixture(directory);
    const sample = join(directory, 'sample');
    await writeFile(sample, 'fixture', { mode: 0o600 });
    const { stdout } = await execFileAsync(
      authority.stat,
      ['-Lc', '%u:%g:%a:%h', '--', sample],
      { ...unprivileged }
    );
    assert.match(stdout, /^\d+:\d+:600:1\n$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
