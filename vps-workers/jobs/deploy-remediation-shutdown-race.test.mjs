import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

it('refuses a superseded release even when remediation is disabled', () => {
  const directory = mkdtempSync(join(tmpdir(), 'remediation-stale-disabled-'));
  try {
    const remoteDir = join(directory, 'remote');
    mkdirSync(remoteDir);
    writeFileSync(join(remoteDir, 'app-checkout.sha'), 'newer-release');
    const policy = join(directory, '.config', 'baci');
    mkdirSync(policy, { recursive: true });
    writeFileSync(join(policy, 'remediation.disabled'), 'disabled');
    const source = readFileSync(
      join(workerRoot, 'lib/install-remediation-cron-transition.sh'),
      'utf8'
    );
    const script = join(directory, 'transition.sh');
    writeFileSync(
      script,
      source.split("<<'REMOTE_SH'\n")[1].split('\nREMOTE_SH')[0]
    );
    const result = spawnSync(
      'bash',
      [
        script,
        remoteDir,
        'unused',
        'node',
        'unused',
        'unused',
        '1',
        '1',
        '/proc',
        'older-release',
      ],
      { encoding: 'utf8' }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /concurrent promote superseded/);
    const currentRelease = spawnSync(
      'bash',
      [
        script,
        remoteDir,
        'unused',
        'node',
        'unused',
        'unused',
        '1',
        '1',
        '/proc',
        'newer-release',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(currentRelease.status, 0, currentRelease.stderr);
    assert.match(currentRelease.stdout, /disabled by operator/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('writes and consumes the same deployment-private cron fragment', () => {
  const source = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
  assert.match(source, /cat > \$STAGING_DIR\/crontab\.fragment/);
  assert.match(source, /bash -s -- '\$STAGING_DIR\/crontab\.fragment'/);
  assert.doesNotMatch(source, /\$REMOTE_DIR\/crontab\.fragment/);
  assert.doesNotMatch(
    source,
    /if \[ "\$REMEDIATION_STATE" = enabled \]; then\s+install_remediation_cron_transition/
  );
});
