import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const brokerUnit = readFileSync(join(workerRoot, 'bin', 'provision-worker-release-boundary.py'), 'utf8');

describe('worker release recovery launch gates', () => {
  it('gates every core daemon and binds its lifetime to the authenticated broker', () => {
    const services = [
      ['baci-domain-event-router.service', 'baci-domain-event-router'],
      ['baci-event-delivery-worker.service', 'baci-event-delivery-worker'],
      ['baci-quiz-finalization.service', 'baci-quiz-finalization'],
    ];
    for (const [file, unit] of services) {
      const source = readFileSync(join(workerRoot, 'systemd', file), 'utf8');
      assert.match(source, /BindsTo=baci-worker-release-broker\.service/);
      assert.match(source, /After=.*baci-worker-release-broker\.service/);
      assert.match(source, new RegExp(`ExecCondition=.*worker-release-launch-gate unit ${unit}`));
    }
  });

  it('gates both scheduled systemd services and reactivates their timers with the broker', () => {
    const cache = readFileSync(join(workerRoot, 'systemd', 'baci-cache-invalidation-drain.service'), 'utf8');
    const cacheTimer = readFileSync(join(workerRoot, 'systemd', 'baci-cache-invalidation-drain.timer'), 'utf8');
    const giglMigration = readFileSync(join(workerRoot, 'bin', 'migrate-gigl-tracking-system-service.sh'), 'utf8');
    assert.match(cache, /ExecCondition=.*worker-release-launch-gate scheduled/);
    assert.match(cache, /BindsTo=baci-worker-release-broker\.service/);
    assert.match(cacheTimer, /BindsTo=baci-worker-release-broker\.service/);
    assert.match(giglMigration, /ExecCondition=.*worker-release-launch-gate scheduled/);
    assert.match(giglMigration, /BindsTo=baci-worker-release-broker\.service/);
    assert.match(giglMigration, /After=network-online\.target baci-worker-release-broker\.service/);
    assert.match(brokerUnit, /Wants=baci-domain-event-router\.service baci-event-delivery-worker\.service baci-quiz-finalization\.service/);
    assert.match(brokerUnit, /Wants=baci-cache-invalidation-drain\.timer baci-gigl-tracking\.timer/);
  });

  it('installs the root-owned launch gate and creates a fresh worker-readable runtime socket directory', () => {
    assert.match(brokerUnit, /InstallFile\("launch-gate"/);
    assert.match(brokerUnit, /worker_release_recovery_latch\.py/);
    assert.match(brokerUnit, /worker_release_quiesce_gate\.py/);
    assert.match(brokerUnit, /install -d -o root -g baci-worker -m 0710/);
    assert.match(brokerUnit, /gate_socket="\$gate_dir\/health\.sock"/);
    assert.match(brokerUnit, /ReadWritePaths=.*\/run\/baci-worker-release-gate/);
  });
});
