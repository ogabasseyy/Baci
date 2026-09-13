import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const root = new URL('.', import.meta.url);
const script = new URL('./retire-ollama.sh', root);
const execFileAsync = promisify(execFile);
const zeroConsumerCounts =
  'systemd-definitions reverse-proxy compose-definitions running-processes running-containers container-definitions container-config'
    .split(' ')
    .map((surface) => ({ surface, matchCount: 0 }));
const missingPreDestructive = (fixture) =>
  assert.rejects(readFile(`${fixture.receiptDir}/pre-destructive.json`));

async function createApplyFixture(
  dependencies,
  dependencyShaOverride,
  reviewStatus = 'approved'
) {
  const dir = await mkdtemp(join(tmpdir(), 'baci-retire-ollama-'));
  const bin = join(dir, 'bin');
  const receiptDir = join(dir, 'receipts');
  const receipt = join(receiptDir, 'receipt.json');
  const inventory = join(dir, 'inventory.json');
  await execFileAsync('mkdir', ['-p', bin, receiptDir]);
  const receiptBytes = `${JSON.stringify({ scan: { dependencies, consumerCounts: zeroConsumerCounts } })}\n`;
  await writeFile(receipt, receiptBytes);
  await chmod(receipt, 0o600);
  const receiptSha = createHash('sha256').update(receiptBytes).digest('hex');
  await writeFile(join(receiptDir, 'receipt.sha256'), `${receiptSha}\n`);
  await chmod(join(receiptDir, 'receipt.sha256'), 0o600);
  await chmod(receiptDir, 0o700);
  const { stdout: canonicalDependencies } = await execFileAsync('jq', [
    '-S',
    '-c',
    '.scan.dependencies',
    receipt,
  ]);
  const dependencySha = createHash('sha256')
    .update(canonicalDependencies)
    .digest('hex');
  await writeFile(
    inventory,
    JSON.stringify({
      reviewStatus,
      approvedEndpointClasses: [
        'disabled',
        'external-provider',
        'ollama-loopback',
      ],
      receiptSha256: receiptSha,
      approvedDependencySha256: dependencyShaOverride ?? dependencySha,
    })
  );
  await chmod(inventory, 0o600);
  await writeFile(join(bin, 'id'), '#!/bin/sh\nprintf "0\\n"\n');
  await writeFile(
    join(bin, 'stat'),
    '#!/bin/sh\nfor arg; do last=$arg; done\nif [ -d "$last" ]; then printf "0:700\\n"; else printf "0:600\\n"; fi\n'
  );
  await writeFile(
    join(bin, 'cat'),
    '#!/bin/sh\ncase "$' +
      '{1:-}" in /sys/fs/cgroup/memory.current) exit 66;; *) exec /bin/cat "$@";; esac\n'
  );
  for (const command of ['jq', 'sha256sum']) {
    const { stdout: tool } = await execFileAsync('which', [command]);
    await writeFile(
      join(bin, command),
      `#!/bin/sh\nexec '${tool.trim()}' "$@"\n`
    );
    await chmod(join(bin, command), 0o755);
  }
  for (const command of ['id', 'stat', 'cat'])
    await chmod(join(bin, command), 0o755);
  return {
    dir,
    receiptDir,
    env: {
      ...process.env,
      RETIRE_OLLAMA_INVENTORY: inventory,
      RETIRE_OLLAMA_RECEIPT_DIR: receiptDir,
      RETIRE_OLLAMA_TEST_BIN: bin,
    },
  };
}

test('defines a finite secret-safe scan for every active Ollama surface', async () => {
  const source = await readFile(script, 'utf8');
  for (const surface of [
    'systemd-definitions',
    'systemd-fragments',
    'systemd-drop-ins',
    'environment-files',
    'systemd-timers',
    'reverse-proxy',
    'compose-definitions',
    'container-definitions',
    'current-crontab',
    'running-processes',
    'running-containers',
    'package-identity',
    'docker-daemon',
    'docker-socket',
    'container-config',
    'model-store-identity',
  ])
    assert.ok(source.includes(surface), surface);
  assert.match(source, /endpoint-class/);
  assert.doesNotMatch(source, /\bprintenv\b|env\s*$/m);
});

test('refuses unreviewed apply before executing a destructive command', async () => {
  const fixture = await createApplyFixture([], undefined, 'pending');
  try {
    await assert.rejects(
      execFileAsync('sh', [script.pathname, '--apply'], { env: fixture.env }),
      (error) =>
        error.code === 78 &&
        /reviewed active inventory required/.test(error.stderr)
    );
    await assert.rejects(
      readFile(join(fixture.receiptDir, 'pre-destructive.json'))
    );
    assert.match(await readFile(script, 'utf8'), /EXIT_REVIEW_REQUIRED=78/);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('binds every destructive action to a fresh revalidation and records rollback needs', async () => {
  const source = await readFile(script, 'utf8');
  const required = [
    'install_crontab',
    'disable_unit',
    'remove_container',
    'delete_models',
  ];
  for (const action of required) {
    assert.match(source, new RegExp(`revalidate_before ${action}`));
    assert.match(source, new RegExp(`record_action ${action}`));
  }
  assert.match(source, /pre-destructive/);
  assert.match(source, /rollbackNeeds/);
  assert.match(
    source,
    /find "\.\/\$\(basename "\$STORE"\)" -xdev -depth -delete/
  );
});
test('requires a lowercase SHA-256 of canonical receipt dependency bytes before apply', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(
    source,
    /dependency_sha\(\).*jq -S -c '\.scan\.dependencies'[\s\S]*sha "\$out"/
  );
  assert.match(
    source,
    /canonical_receipt_digest\(\).*printf '%s\\n' "\$digest"/s
  );
  assert.doesNotMatch(source, /--arg receiptSha256 "\$expected"/);
  assert.doesNotMatch(source, /dependencies \| tojson \| @base64/);
});

test('fails every scan and digest command explicitly without a pipefail dependency', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(source, /record_scan\(\)[\s\S]*digest_command/);
  assert.match(source, /digest_command\(\)[\s\S]*scan failed/);
  assert.match(source, /hash_text\(\).*temp_path/);
  assert.match(source, /scan_nginx_definitions\(\)/);
  assert.match(source, /scan_compose_definitions\(\)/);
  assert.doesNotMatch(
    source,
    /\$@" \| sha256sum|sha256sum \| cut|jq -S -c .*\| sha256sum/
  );
});

test('revalidates only prior identity-bound mutations and proves every postcondition', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(source, /normalize_revalidation_snapshot\(\)/);
  assert.match(
    source,
    /install_crontab\(\)[\s\S]*assert_postcondition install_crontab/
  );
  assert.match(
    source,
    /disable_unit\(\)[\s\S]*assert_postcondition disable_unit/
  );
  assert.match(
    source,
    /remove_container\(\)[\s\S]*assert_postcondition remove_container/
  );
  assert.match(
    source,
    /delete_models\(\)[\s\S]*assert_postcondition delete_models/
  );
  assert.match(source, /record_action install_crontab/);
  assert.match(source, /\.class != "current-crontab"/);
  assert.match(source, /\.class != "systemd-timers"/);
});

test('records measured host and model-store deltas in the completion receipt', async () => {
  const source = await readFile(script, 'utf8');
  for (const helper of [
    'cgroup_memory_bytes',
    'host_available_memory_bytes',
    'model_store_bytes',
    'completion_metrics',
  ])
    assert.match(source, new RegExp(`${helper}\\(\\)`));
  assert.match(source, /cgroupMemoryBytes/);
  assert.match(source, /hostAvailableMemoryBytes/);
  assert.match(source, /modelStoreBytes/);
  assert.match(source, /deltas/);
  assert.doesNotMatch(source, /models:"deleted"/);
});

test('accepts only the reviewed Ubuntu Docker socket alias and pins its identity', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(source, /assert_docker_socket\(\)/);
  assert.match(source, /readlink -f -- \/var\/run/);
  assert.match(source, /\[ "\$real" = \/run\/docker\.sock \]/);
  assert.match(source, /\[ -S "\$real" \] && \[ ! -L "\$real" \]/);
  assert.match(source, /getent group docker/);
  assert.match(source, /"0:\$docker_gid:660"/);
  assert.match(source, /docker socket identity changed/);
  assert.match(
    source,
    /docker_socket_scan_begin; record_scan container-definitions[\s\S]*docker_socket_scan_end; record_docker_socket/
  );
  assert.doesNotMatch(source, /record_path docker-socket "\$SOCKET"/);
});

test('keeps the configured Docker socket alias immutable across every apply revalidation', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(
    source,
    /DOCKER_SOCKET_ALIAS=\/var\/run\/docker\.sock; CANONICAL_DOCKER_SOCKET=''/
  );
  assert.match(source, /CANONICAL_DOCKER_SOCKET=\$real/);
  assert.doesNotMatch(
    source,
    /DOCKER_SOCKET_ALIAS=\$real|(?:^|[;\n])SOCKET=\$real/m
  );
  assert.match(
    source,
    /revalidate_before install_crontab[\s\S]*revalidate_before disable_unit[\s\S]*revalidate_before remove_container[\s\S]*revalidate_before delete_models/
  );
  assert.match(
    source,
    /docker_socket_scan_begin; record_scan container-definitions[\s\S]*docker_socket_scan_end; record_docker_socket/
  );
  assert.match(source, /--host "unix:\/\/\$CANONICAL_DOCKER_SOCKET"/);
});

for (const dependency of [
  { 'endpoint-class': 'external-provider', disposition: 'review' },
  { 'endpoint-class': 'external-provider', disposition: 'approved' },
  { 'endpoint-class': 'unknown', disposition: 'unknown' },
]) {
  test(`refuses a nonempty ${dependency.disposition} dependency set before destructive preparation`, async () => {
    const fixture = await createApplyFixture([dependency]);
    const expectedFailure =
      dependency['endpoint-class'] === 'unknown'
        ? /unapproved dependency endpoint class/
        : /retirement requires zero dependencies/;
    try {
      await assert.rejects(
        execFileAsync('sh', [script.pathname, '--apply'], {
          env: fixture.env,
        }),
        (error) => error.code === 78 && expectedFailure.test(error.stderr)
      );
      await missingPreDestructive(fixture);
    } finally {
      await rm(fixture.dir, { recursive: true, force: true });
    }
  });
}

test('refuses dependency digest drift before destructive preparation', async () => {
  const fixture = await createApplyFixture([], 'a'.repeat(64));
  try {
    await assert.rejects(
      execFileAsync('sh', [script.pathname, '--apply'], {
        env: fixture.env,
      }),
      (error) =>
        error.code === 78 &&
        /independent dependency review required/.test(error.stderr)
    );
    await missingPreDestructive(fixture);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});
