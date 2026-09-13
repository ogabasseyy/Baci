import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import { createSourceArchive } from './source-archive.mjs';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-image-filesystem.pl', import.meta.url);
const runningContainer = new URL(
  './retire-ollama-running-container.sh',
  import.meta.url
);
const sourceLoader = new URL(
  './retire-ollama-source-loader.sh',
  import.meta.url
);
const projectorSourceSha = 'a'.repeat(40);
const digest = (value) => createHash('sha256').update(value).digest('hex');
async function projectorAuthorityFixture(directory, suppliedBytes) {
  const sourceRoot = join(directory, 'source');
  const receiptRoot = join(directory, 'receipts');
  const sourceDirectory = join(sourceRoot, projectorSourceSha);
  const receiptDirectory = join(receiptRoot, projectorSourceSha);
  const projector = join(sourceDirectory, 'retire-ollama-image-filesystem.pl');
  const projectorBytes = suppliedBytes ?? (await readFile(helper));
  const projectorSha = digest(projectorBytes);
  await mkdir(sourceDirectory, { mode: 0o700, recursive: true });
  await mkdir(receiptDirectory, { mode: 0o700, recursive: true });
  await writeFile(projector, projectorBytes, { mode: 0o644 });
  await chmod(projector, 0o644);
  await chmod(sourceRoot, 0o700);
  await chmod(receiptRoot, 0o700);
  const manifest = {
    authority: {
      deploymentMarker: 'projector-auth-test',
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
          blobSha256: projectorSha,
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
  await writeFile(
    stat,
    '#!' +
      process.execPath +
      "\nconst fs=require('node:fs');const a=process.argv.slice(2),i=a.indexOf('-c'),f=i>=0?a[i+1]:a.find(v=>v.startsWith('--format='))?.slice(9),p=a.at(-1),s=fs.lstatSync(p),m=s.mode&0o7777;const r=(f??'%a').replaceAll('%u',String(s.uid)).replaceAll('%g',String(s.gid)).replaceAll('%a',m.toString(8)).replaceAll('%h','1').replaceAll('%s',String(s.size));process.stdout.write(r+'\\n');\n",
    { mode: 0o755 }
  );
  return { projector, sourceDirectory, sourceRoot, receiptRoot, stat };
}
function imageArchive(layers) {
  const layerMembers = layers.map((entries) =>
    createSourceArchive(
      entries.map(({ path, content = '' }) => ({
        bytes: Buffer.from(content),
        mode: '100644',
        path,
      }))
    )
  );
  return createSourceArchive([
    ...layerMembers.map((bytes, index) => ({
      bytes,
      mode: '100644',
      path: `layer-${index}.tar`,
    })),
    {
      bytes: Buffer.from(
        JSON.stringify([
          {
            Config: 'config.json',
            Layers: layers.map((_layer, index) => `layer-${index}.tar`),
          },
        ])
      ),
      mode: '100644',
      path: 'manifest.json',
    },
  ]);
}
async function writeArchive(directory, layers) {
  await writeFile(join(directory, 'image.tar'), imageArchive(layers), {
    mode: 0o600,
  });
}
function shellCommand(authority) {
  const toolRoot = authority.stat.slice(0, authority.stat.lastIndexOf('/'));
  return (
    '. "' +
    sourceLoader.pathname +
    '"; . "$1"; SCRIPT_DIR="' +
    authority.sourceDirectory +
    '"; PATH="' +
    toolRoot +
    ':$PATH"; RETIRE_OLLAMA_TEST_BIN="' +
    toolRoot +
    '"; RETIRE_OLLAMA_PROJECTOR_TEST_SOURCE_ROOT="' +
    authority.sourceRoot +
    '"; RETIRE_OLLAMA_PROJECTOR_TEST_RECEIPT_ROOT="' +
    authority.receiptRoot +
    '"; sha() { /usr/bin/shasum -a 256 "$1" | /usr/bin/cut -c1-64; }; running_container_image_matches_merged "$2/image.tar" "$3" && printf matched'
  );
}
async function runProjection(directory, authority, deadline, ambientDeadline) {
  const clock =
    'running_container_now() { printf 0; };' +
    (ambientDeadline === undefined
      ? ''
      : `running_image_deadline=${ambientDeadline};`);
  const { stdout } = await execFileAsync('sh', [
    '-c',
    clock + shellCommand(authority),
    runningContainer.pathname.replace(/\.sh$/, '-test.sh'),
    runningContainer.pathname,
    directory,
    deadline === undefined ? '' : String(deadline),
  ]);
  return stdout.trim();
}
test('authenticates and executes the fixed Perl projector from the shell helper', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-projector-auth-'));
  try {
    await writeArchive(directory, [
      [{ content: 'ordinary service configuration', path: 'etc/service.conf' }],
      [
        {
          content: 'current endpoint http://127.0.0.1:11434',
          path: 'etc/current.conf',
        },
      ],
    ]);
    const authority = await projectorAuthorityFixture(directory);
    assert.equal(await runProjection(directory, authority, 1), 'matched');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
test('fails closed when the projector misses the running archive deadline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-projector-deadline-'));
  try {
    await writeArchive(directory, [
      [{ content: 'ordinary service configuration', path: 'etc/service.conf' }],
    ]);
    const prefix = 'BEGIN { sleep 2; }\n';
    const authority = await projectorAuthorityFixture(
      directory,
      Buffer.from(prefix + '#'.repeat(65_536 - prefix.length))
    );
    await assert.rejects(
      runProjection(directory, authority, 1),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
test('does not execute a same-inode projector rewrite with a mismatched digest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-projector-rewrite-'));
  const markerA = join(directory, 'marker-a');
  const markerB = join(directory, 'marker-b');
  const scriptFor = (marker, value) => {
    const prefix =
      "BEGIN { open my $fh, '>', '" +
      marker +
      "'; print {$fh} '" +
      value +
      "'; close $fh; }\n";
    return Buffer.from(prefix + '#'.repeat(65_536 - prefix.length));
  };
  const bytesA = scriptFor(markerA, 'A');
  const bytesB = scriptFor(markerB, 'B');
  try {
    const authority = await projectorAuthorityFixture(directory, bytesA);
    const projector = authority.projector;
    await writeArchive(directory, [[{ path: 'etc/empty.conf', content: '' }]]);
    const before = await lstat(projector);
    const handle = await open(projector, 'r+');
    await handle.write(bytesB, 0, bytesB.length, 0);
    await handle.truncate(bytesB.length);
    await handle.close();
    const after = await lstat(projector);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
    assert.equal(after.size, before.size);
    const child = runProjection(directory, authority, 1);
    await assert.rejects(child, (error) => error.code === 2);
    await assert.rejects(readFile(markerA));
    await assert.rejects(readFile(markerB));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
test('rejects a same-inode manifest rewrite before projector authorization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-projector-manifest-'));
  try {
    await writeArchive(directory, [[{ path: 'etc/empty.conf', content: '' }]]);
    const authority = await projectorAuthorityFixture(directory);
    const manifestPath = join(
      authority.receiptRoot,
      projectorSourceSha,
      'manifest.json'
    );
    const before = await lstat(manifestPath);
    const forged = JSON.parse(await readFile(manifestPath, 'utf8'));
    forged.sourceArchive.entries[0].blobSha256 = '0'.repeat(64);
    const forgedBytes = Buffer.from(canonicalJson(forged));
    const handle = await open(manifestPath, 'r+');
    await handle.write(forgedBytes, 0, forgedBytes.length, 0);
    await handle.truncate(forgedBytes.length);
    await handle.close();
    const after = await lstat(manifestPath);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    await assert.rejects(
      runProjection(directory, authority, 1),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
test('fails closed when the authenticated projector child exits nonzero', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-projector-child-'));
  try {
    await writeArchive(directory, [[{ path: 'etc/empty.conf', content: '' }]]);
    const prefix = 'BEGIN { exit 2; }\n';
    const authority = await projectorAuthorityFixture(
      directory,
      Buffer.from(prefix + '#'.repeat(65_536 - prefix.length))
    );
    await assert.rejects(
      runProjection(directory, authority, 1),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
