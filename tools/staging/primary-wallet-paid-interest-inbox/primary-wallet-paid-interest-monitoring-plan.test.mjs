import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrimaryInterestMonitoringPlan } from './primary-wallet-paid-interest-activation-artifacts.mjs';

test('monitoring plan specifies aggregate-only health and remains unconfigured', () => {
  const plan = createPrimaryInterestMonitoringPlan({
    host: 'bassey@82.29.190.219',
    capturedAt: '2026-10-27T01:38:40.655Z',
    accountPresent: false,
    units: {
      'baci-primary-paid-interest.service': {
        LoadState: 'not-found',
        ActiveState: 'inactive',
      },
      'baci-primary-paid-interest.timer': {
        LoadState: 'not-found',
        ActiveState: 'inactive',
      },
    },
  });

  assert.equal(plan.activationAuthorized, false);
  assert.equal(plan.status, 'blocked_on_operator_and_database_contract');
  assert.equal(plan.suppliedHostInventory.workerAccountPresent, false);
  assert.equal(plan.suppliedHostInventory.timer.LoadState, 'not-found');
  assert.equal(
    plan.suppliedHostInventory.classification,
    'supplied_host_metadata_only_not_database_or_configuration_verification'
  );
  assert.equal(
    plan.proposedDatabaseBoundary.role,
    'piggyvest_primary_interest_monitor'
  );
  assert.match(plan.proposedDatabaseBoundary.tablePrivileges, /None/);
  assert.match(plan.proposedDatabaseBoundary.provisioning, /Not implemented/);
  assert.equal(plan.alertDelivery.destination, null);
  assert.equal(plan.alertDelivery.transport, null);
  assert.equal(plan.alertDelivery.externalMessagesSent, false);
  assert.match(
    plan.alertDelivery.existingConfigDisposition,
    /not approved or reused/
  );
  assert.ok(
    plan.healthSignals.some((signal) =>
      /never return event IDs, payloads, signatures/.test(signal)
    )
  );

  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(
    serialized,
    /SUPABASE_SERVICE_ROLE_KEY|PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET|ZEPTOMAIL_TOKEN/
  );
  assert.doesNotMatch(serialized, /enable --now|systemctl start|curl |fetch\(/);
});
