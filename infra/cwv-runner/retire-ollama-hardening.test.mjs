// biome-ignore-all format: compact hardening fixtures stay within the source ceiling.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const root = new URL('.', import.meta.url); const script = new URL('./retire-ollama.sh', root); const execFileAsync = promisify(execFile);
test('keeps the sealed Task 8 scan entrypoint directly executable', async () => {
  assert.equal((await stat(script)).mode & 0o777, 0o755);
});
test('keeps the scan finite when nginx is not installed', async () => {
  const source = await readFile(new URL('./retire-ollama-consumers.sh', root), 'utf8');
  assert.match(
    source,
    /scan_nginx_definitions\(\).*\[ ! -e "\$NGINX_ROOT" \] && return 0/s
  );
});
test('classifies every non-environment consumer surface without retaining raw values', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(source, /record_consumers\(\)/);
  assert.match(source, /classifiedPathSha256/);
  assert.match(source, /reverse-proxy\|compose-definitions/);
  assert.match(
    source,
    /systemd-definitions\|reverse-proxy\|compose-definitions\|running-containers\|container-definitions/
  );
  assert.match(source, /running-processes\) record_consumers/);
  assert.match(source, /record_consumers container-config/);
  assert.match(source, /scan_systemd_consumers\(\)/);
  assert.match(source, /scan_container_rows\(\)/);
  assert.match(source, /record_consumers container-config "\$out" none/);
  assert.match(source, /assert_zero_consumers\(\)/);
  assert.match(source, /retirement requires zero classified consumers/);
  assert.match(source, /\|ollama\|\*\/ollama\) matched=1/);
  assert.doesNotMatch(source, /consumerPath|rawCommand|consumerValue/);
});

test('fails closed before any destructive preparation when a receipt publication is partial', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'baci-receipt-partial-'));
  const bin = join(dir, 'bin');
  const receiptDir = join(dir, 'receipts');
  const receipt = join(receiptDir, 'receipt.json');
  const inventory = join(dir, 'inventory.json');
  try {
    await mkdir(bin);
    await mkdir(receiptDir);
    const receiptBytes = '{"scan":{"dependencies":[],"consumerCounts":[]}}\n';
    const receiptSha = createHash('sha256').update(receiptBytes).digest('hex');
    await writeFile(receipt, receiptBytes);
    await writeFile(join(receiptDir, 'receipt.sha256'), `${receiptSha}\n`);
    await writeFile(join(receiptDir, 'receipt.json.pending'), 'partial\n');
    await writeFile(inventory, JSON.stringify({ receiptSha256: receiptSha }));
    await writeFile(join(bin, 'id'), '#!/bin/sh\nprintf "0\\n"\n');
    await writeFile(
      join(bin, 'stat'),
      '#!/bin/sh\nfor arg; do last=$arg; done\nif [ -d "$last" ]; then printf "0:700\\n"; else printf "0:600\\n"; fi\n'
    );
    await Promise.all(
      [
        receipt,
        join(receiptDir, 'receipt.sha256'),
        join(receiptDir, 'receipt.json.pending'),
        inventory,
      ].map((path) => chmod(path, 0o600))
    );
    await Promise.all([bin, receiptDir].map((path) => chmod(path, 0o700)));
    await Promise.all(
      ['id', 'stat'].map((name) => chmod(join(bin, name), 0o755))
    );
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          '. "$1"; init_temp_root() { :; }; cleanup_temp() { :; }; retirement_helpers() { :; }; main --apply',
          `${script.pathname}.source`,
          script.pathname,
        ],
        {
          env: {
            ...process.env,
            RETIRE_OLLAMA_INVENTORY: inventory,
            RETIRE_OLLAMA_RECEIPT_DIR: receiptDir,
            RETIRE_OLLAMA_TEST_BIN: bin,
          },
        }
      ),
      (error) =>
        error.code === 65 && /partial receipt publication/.test(error.stderr)
    );
    await assert.rejects(readFile(join(receiptDir, 'pre-destructive.json')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('publishes every receipt with a durable pending-file rename protocol', async () => {
  const source = await readFile(script, 'utf8');
  for (const helper of [
    'fsync_dir()',
    'pending_for()',
    'publish_pending()',
    'discard_pending()',
    'assert_no_pending_receipts()',
  ])
    assert.ok(source.includes(helper));
  for (const target of [
    'receipt.json',
    'receipt.sha256',
    'pre-destructive.json',
    'pre-destructive.actions',
    'completion.json',
  ])
    assert.ok(source.includes(target));
  assert.match(
    source,
    /publish_pending "\$sha_pending" "\$RECEIPT_SHA"[\s\S]*publish_pending "\$receipt_pending" "\$RECEIPT"/
  );
  const publication = source.match(/publish_pending\(\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(publication, 'publish_pending body must be present');
  const targetGuard = publication.indexOf("[ ! -e \"$target\" ] && [ ! -L \"$target\" ] || die 'receipt publication race'");
  const stateGuard = publication.indexOf('case "$target_state" in absent)');
  const noOverwrite = publication.indexOf("/usr/bin/perl -e 'exit(link($ARGV[0],$ARGV[1]) ? 0 : 1)'");
  const rename = publication.indexOf('mv -T "$pending" "$target"');
  const postGuard = publication.indexOf("[ -f \"$target\" ] && [ ! -L \"$target\" ] || die 'receipt publication target unsafe'");
  assert.ok(targetGuard >= 0 && stateGuard >= 0 && noOverwrite > stateGuard, 'absent target must use no-overwrite publication');
  assert.ok(rename > noOverwrite, 'existing target replacement must remain explicit');
  assert.ok(postGuard > rename, 'renamed target must be checked after publication');
  assert.doesNotMatch(publication, /mv -f "\$pending"/);
});

// biome-ignore format: a narrow shell harness keeps this behavioral contract below the modularity ceiling.
test('collects model identity only for scan or deletion phases', async () => {
  const source = await readFile(script, 'utf8');
  const invocation = phase => execFileAsync('sh', ['-c', '. "$1"; model_identity() { printf "identity\\n"; }; model_store_bytes() { printf "bytes\\n"; }; model_phase_values "$2"', 'retire-ollama-model-phase-test', script.pathname, phase], { env: process.env });
  const scanned = 'identity\nbytes\n';
  assert.equal((await invocation('scan')).stdout, scanned);
  assert.equal((await invocation('delete_models')).stdout, scanned);
  assert.equal((await invocation('revalidate')).stdout, 'unscanned\nunscanned\n');
  await assert.rejects(invocation('unknown'), error => error.code === 65 && /unknown collection phase/.test(error.stderr));
  assert.match(source, /install_crontab\).*del\(\.cronSha256,\.units\[\]\.(?:state),\.model\).*model-store-identity/s);
});

test('enforces the reviewed endpoint-class vocabulary before dependency approval', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(source, /approved_endpoint_classes\(\)/);
  assert.match(source, /assert_approved_dependency_classes\(\)/);
  assert.match(
    source,
    /canonical_receipt; \[ "\$\(jq -er '\.reviewStatus' "\$INVENTORY"\)" = approved \].*assert_approved_dependency_classes/
  );
});

test('requires an immutable inventory and deletes from the verified store path', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(
    source,
    /safe_file "\$INVENTORY" \|\| die 'immutable reviewed inventory required'/
  );
  assert.match(
    source,
    /cd "\$\(dirname "\$STORE"\)" && find "\.\/\$\(basename "\$STORE"\)" -xdev -depth -delete/
  );
});

test('creates and revalidates the receipt directory without following links', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(source, /ensure_receipt_dir\(\)/);
  assert.match(source, /\[ -L "\$RECEIPT_DIR" \].*safe_dir "\$RECEIPT_DIR"/s);
  assert.match(source, /write_receipt\(\).*ensure_receipt_dir/s);
  assert.match(
    source,
    /canonical_receipt;.*ensure_receipt_dir.*pre-destructive/s
  );
});

test('fails closed for malformed digests, crontab reads, and writable model parents', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(source, /case "\$digest" in \*\[!0-9a-f\]\*\|''\)/);
  assert.match(
    source,
    /crontab -u "\$OWNER" -l.*\[ "\$status" -eq 1 \] \|\| die 'crontab read failed'/s
  );
  assert.match(source, /0\$model_parent_mode & 022/);
});

test('does not carry a removed container identity into the deletion revalidation', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(source, /collect\(\).*id='' image='' config=''/s);
});

test('owns one private temporary directory and cleans it after a rejected apply', async () => {
  const source = await readFile(script, 'utf8');
  assert.doesNotMatch(source, /json_sha\(\)/);
  assert.match(source, /init_temp_root\(\)/);
  assert.match(source, /trap 'cleanup_temp' EXIT HUP INT TERM/);

  const parent = await mkdtemp(join(tmpdir(), 'baci-retire-ollama-cleanup-'));
  try {
    const bin = join(parent, 'bin');
    const hit = join(parent, 'test-bin-hit');
    await chmod(parent, 0o777);
    await mkdir(bin);
    await writeFile(
      join(bin, 'id'),
      '#!/bin/sh\nprintf "0\\n"\n: > "$RETIRE_OLLAMA_TEST_HIT"\n'
    );
    await chmod(bin, 0o755);
    await chmod(join(bin, 'id'), 0o755);
    await assert.rejects(
      execFileAsync('sh', [script.pathname, '--apply'], {
        env: {
          ...process.env,
          RETIRE_OLLAMA_TMPDIR: parent,
          RETIRE_OLLAMA_INVENTORY: join(parent, 'missing.json'),
          RETIRE_OLLAMA_RECEIPT_DIR: join(parent, 'missing-receipt'),
          RETIRE_OLLAMA_TEST_BIN: bin,
          RETIRE_OLLAMA_TEST_HIT: hit,
        },
      })
    );
    assert.deepEqual((await readdir(parent)).sort(), ['bin', 'test-bin-hit']);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('dispatches direct dash invocations and can still be sourced as a library', async () => {
  for (const [argument, code, message] of [
    ['--scan', 77, /root required/],
    ['--unsupported', 64, /usage: retire-ollama\.sh/],
  ])
    await assert.rejects(
      execFileAsync('/bin/dash', [script.pathname, argument], {
        env: process.env,
      }),
      (error) => error.code === code && message.test(error.stderr)
    );

  const { stdout } = await execFileAsync(
    'sh',
    [
      '-c',
      '. "$1"; command -v normalize_revalidation_snapshot; command -v main',
      'retire-ollama-source-test',
      script.pathname,
    ],
    { env: process.env }
  );
  assert.equal(stdout, 'normalize_revalidation_snapshot\nmain\n');
});

test('extracts the flat scan snapshot before destructive revalidation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'baci-revalidation-snapshot-'));
  const receipt = join(dir, 'receipt.json');
  const output = join(dir, 'scan.json');
  const scan = { units: [], records: [], dependencies: [] };
  try {
    await writeFile(receipt, JSON.stringify({ schemaVersion: 2, scan }));
    await execFileAsync('sh', [
      '-c',
      '. "$1"; receipt_scan_snapshot "$2" "$3"',
      'retire-ollama-revalidation-test',
      script.pathname,
      receipt,
      output,
    ]);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), scan);
    const source = await readFile(script, 'utf8');
    assert.match(
      source,
      /receipt_scan_snapshot "\$RECEIPT" "\$baseline"[\s\S]*normalize_revalidation_snapshot "\$baseline"/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
