import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workerRoot = new URL('..', import.meta.url).pathname;
const transport = join(workerRoot, 'lib', 'worker-transport.sh');

function runBash(script, env = {}) {
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('local transport identity is pinned to the verified worker host, user, and path', () => {
  const helper = readFileSync(transport, 'utf8');
  assert.match(helper, /worker_assert_local_identity/);
  const check = runBash(
    `source '${transport}'; worker_assert_local_identity bassey ogabassey /home/bassey/baci-workers /home/bassey bassey bassey 1001 bassey`,
  );
  assert.equal(check.status, 0, check.stderr);
});

test('local transport refuses a different user, host, or worker directory', () => {
  const helper = readFileSync(transport, 'utf8');
  assert.match(helper, /worker_assert_local_identity/);
  for (const identity of [
    ['root', 'ogabassey', '/home/bassey/baci-workers', '/home/bassey', 'bassey', 'bassey', '1001', 'bassey'],
    ['bassey', 'other-host', '/home/bassey/baci-workers', '/home/bassey', 'bassey', 'bassey', '1001', 'bassey'],
    ['bassey', 'ogabassey', '/tmp/baci-workers', '/home/bassey', 'bassey', 'bassey', '1001', 'bassey'],
    ['bassey', 'ogabassey', '/home/bassey/baci-workers', '/root', 'bassey', 'bassey', '1001', 'bassey'],
    ['bassey', 'ogabassey', '/home/bassey/baci-workers', '/home/bassey', 'root', 'bassey', '1001', 'bassey'],
    ['bassey', 'ogabassey', '/home/bassey/baci-workers', '/home/bassey', 'bassey', 'root', '1001', 'bassey'],
    ['bassey', 'ogabassey', '/home/bassey/baci-workers', '/home/bassey', 'bassey', 'bassey', '1002', 'bassey'],
    ['bassey', 'ogabassey', '/home/bassey/baci-workers', '/home/bassey', 'bassey', 'bassey', '1001', 'root'],
  ]) {
    const check = runBash(
    `source '${transport}'; worker_assert_local_identity '${identity[0]}' '${identity[1]}' '${identity[2]}' '${identity[3]}' '${identity[4]}' '${identity[5]}' '${identity[6]}' '${identity[7]}'`,
    );
    assert.notEqual(check.status, 0, `unexpectedly accepted identity ${identity.join(':')}`);
  }
});

test('local remote-command adapter runs on host and preserves heredoc stdin', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-worker-transport-'));
  try {
    const output = join(directory, 'remote-input.txt');
    const script = `source '${transport}'; WORKER_TRANSPORT=local; WORKER_SSH_TARGET='bassey@82.29.190.219'; worker_exec_target "$WORKER_SSH_TARGET" "cat > '${output}'" <<'PAYLOAD'\nfixture payload\nPAYLOAD`;
    const result = runBash(script);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'fixture payload\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local remote-command adapter does not forward coordinator credentials', () => {
  const result = runBash(
    `source '${transport}'; WORKER_TRANSPORT=local; WORKER_SSH_TARGET='bassey@82.29.190.219'; worker_exec_target "$WORKER_SSH_TARGET" 'printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "\${GH_TOKEN:-}" "\${GITHUB_TOKEN:-}" "\${VERCEL_TOKEN:-}" "\${BACI_WORKER_DEPLOY_LOCAL:-}" "\${COORDINATOR_SECRET:-}"'`,
    { GH_TOKEN: 'github-secret', GITHUB_TOKEN: 'actions-secret', VERCEL_TOKEN: 'vercel-secret', BACI_WORKER_DEPLOY_LOCAL: '1', COORDINATOR_SECRET: 'unknown-secret', XDG_RUNTIME_DIR: '/tmp/untrusted', DBUS_SESSION_BUS_ADDRESS: 'tcp:host=evil' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '\n\n\n\n\n');
});

test('local remote-command adapter runs with a minimal environment, not a credential blacklist', () => {
  const result = runBash(
    `source '${transport}'; WORKER_TRANSPORT=local; WORKER_SSH_TARGET='bassey@82.29.190.219'; worker_exec_target "$WORKER_SSH_TARGET" 'printf "%s\\n%s\\n" "\${COORDINATOR_SECRET:-}" "\${GITHUB_WORKSPACE:-}"'`,
    { COORDINATOR_SECRET: 'unknown-secret', GITHUB_WORKSPACE: '/runner/work/repo' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '\n\n');
});

test('local command adapter refuses any target other than the pinned VPS endpoint', () => {
  const result = runBash(
    `source '${transport}'; WORKER_TRANSPORT=local; worker_exec_target 'bassey@other-host' 'true'`,
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected target/);
});

test('local rsync adapter copies only to the selected staging tree', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-worker-transport-'));
  try {
    const source = join(directory, 'source');
    const stage = join(directory, 'stage');
    mkdirSync(source);
    writeFileSync(join(source, 'worker.mjs'), 'fixture');
    const result = runBash(
      `source '${transport}'; WORKER_TRANSPORT=local; WORKER_ROOT='${source}'; STAGING_DIR='${stage}'; worker_rsync_to_stage "$STAGING_DIR/" -av --delete --exclude='.env*' --exclude=node_modules --exclude=logs --exclude=locks '${source}/'`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(stage, 'worker.mjs'), 'utf8'), 'fixture');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local rsync permits only the pinned dotenv helper copy operation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-worker-transport-'));
  try {
    const root = join(directory, 'vps-workers');
    const helper = join(directory, '.github', 'scripts', 'gigl-dotenv.sh');
    const stage = join(directory, 'stage');
    mkdirSync(root, { recursive: true });
    mkdirSync(join(directory, '.github', 'scripts'), { recursive: true });
    mkdirSync(join(stage, 'bin'), { recursive: true });
    writeFileSync(helper, '# dotenv fixture\n');
    const result = runBash(
      `source '${transport}'; WORKER_TRANSPORT=local; WORKER_ROOT='${root}'; STAGING_DIR='${stage}'; worker_rsync_to_stage "$STAGING_DIR/bin/gigl-dotenv.sh" -av '${root}/../.github/scripts/gigl-dotenv.sh'`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(stage, 'bin', 'gigl-dotenv.sh'), 'utf8'), '# dotenv fixture\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local rsync adapter refuses destinations outside the current staging tree', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-worker-transport-'));
  try {
    const result = runBash(
      `source '${transport}'; WORKER_TRANSPORT=local; STAGING_DIR='${join(directory, 'stage')}'; worker_rsync_to_stage '${join(directory, 'outside')}' -av '${directory}/source'`,
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the current staging tree/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local rsync adapter refuses arbitrary sources and unsafe deletion flags', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-worker-transport-'));
  try {
    const stage = join(directory, 'stage');
    const checkout = join(directory, 'checkout');
    const outsideSource = join(directory, 'outside');
    mkdirSync(checkout);
    mkdirSync(outsideSource);
    const arbitrary = runBash(
      `source '${transport}'; WORKER_TRANSPORT=local; WORKER_ROOT='${checkout}'; STAGING_DIR='${stage}'; worker_rsync_to_stage "$STAGING_DIR/" -a '${outsideSource}/'`,
    );
    assert.notEqual(arbitrary.status, 0);
    assert.match(arbitrary.stderr, /source or destination is outside/);

    const deleteFlag = runBash(
      `source '${transport}'; WORKER_TRANSPORT=local; WORKER_ROOT='${checkout}'; STAGING_DIR='${stage}'; worker_rsync_to_stage "$STAGING_DIR/" -a --delete-excluded '${checkout}/'`,
    );
    assert.notEqual(deleteFlag.status, 0);
    assert.match(deleteFlag.stderr, /unexpected rsync arguments/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local identity validation is not affected by a hostile PATH', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-worker-transport-'));
  try {
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    const marker = join(directory, 'hostile-path-used');
    const commands = {
      id: '#!/bin/sh\nprintf invoked >> "$WORKER_HOSTILE_PATH_MARKER"\nprintf bassey\n',
      hostname: '#!/bin/sh\nprintf invoked >> "$WORKER_HOSTILE_PATH_MARKER"\nprintf ogabassey\n',
      readlink: '#!/bin/sh\nprintf invoked >> "$WORKER_HOSTILE_PATH_MARKER"\nprintf /home/bassey/baci-workers\n',
      stat: '#!/bin/sh\nprintf invoked >> "$WORKER_HOSTILE_PATH_MARKER"\nprintf bassey\n',
    };
    for (const [name, script] of Object.entries(commands)) {
      writeFileSync(join(bin, name), script, { mode: 0o755 });
    }
    const result = runBash(
      `source '${transport}'; REMOTE_DIR=/home/bassey/baci-workers; BACI_WORKER_DEPLOY_LOCAL=1; worker_configure_transport`,
      {
        PATH: bin, HOME: '/home/bassey', WORKER_HOSTILE_PATH_MARKER: marker,
        XDG_RUNTIME_DIR: '/run/user/1001', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1001/bus',
      },
    );
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(marker), false, 'identity probes must not execute PATH-provided commands');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('transport configuration keeps SSH default and rejects unknown selectors', () => {
  const result = runBash(
    `source '${transport}'; worker_configure_transport; test "$WORKER_TRANSPORT" = ssh; BACI_WORKER_DEPLOY_LOCAL=maybe worker_configure_transport`,
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be unset, 0, or 1/);
});

test('SSH remains the default transport and keeps the target and stdin intact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-worker-transport-'));
  try {
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    const capture = join(directory, 'ssh-call.txt');
    writeFileSync(
      join(bin, 'ssh'),
      '#!/bin/sh\nprintf "%s\\n" "$*" > "$WORKER_SSH_CAPTURE"\ncat >> "$WORKER_SSH_CAPTURE"\n',
      { mode: 0o755 },
    );
    const result = runBash(
      `source '${transport}'; unset WORKER_TRANSPORT; WORKER_SSH_TARGET='bassey@82.29.190.219'; worker_exec_target "$WORKER_SSH_TARGET" 'cat' <<'PAYLOAD'\nssh payload\nPAYLOAD`,
      { PATH: `${bin}:${process.env.PATH}`, WORKER_SSH_CAPTURE: capture },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(capture, 'utf8'), 'bassey@82.29.190.219 cat\nssh payload\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
