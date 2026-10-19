import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { reportAcceptance } from './report.mjs';

const savedResult = JSON.parse(
  readFileSync(
    new URL('../contract-e2e/result-20261002.json', import.meta.url),
    'utf8'
  )
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fixture(change = () => undefined) {
  const base = 'tools/staging/interest-bridge/contract-e2e';
  const files = new Map();
  const lines = Array.from({ length: 25 }, (_, index) => {
    const name = `module-${index}.mjs`;
    const bytes = Buffer.from(`export const value = ${index};\n`);
    files.set(`${base}/${name}`, bytes);
    return `${sha256(bytes)}  ${name}`;
  });
  const manifest = Buffer.from(`${lines.join('\n')}\n`);
  files.set(`${base}/SOURCE-SHA256SUMS`, manifest);
  const result = structuredClone(savedResult);
  result.harnessSource.sha256 = sha256(manifest);
  change(result);
  files.set(`${base}/result.json`, Buffer.from(JSON.stringify(result)));
  const evidence = [
    ['implemented', 'source-manifest', 'SOURCE-SHA256SUMS'],
    ['tested', 'synthetic-result', 'result.json'],
  ].map(([category, kind, name]) => ({
    id: category,
    category,
    kind,
    path: `${base}/${name}`,
    sha256: sha256(files.get(`${base}/${name}`)),
  }));
  const input = { schemaVersion: 1, evidence };
  const options = {
    read: (path) => {
      if (!files.has(path)) throw new Error('Missing evidence');
      return files.get(path);
    },
  };
  return { input, options, files, base };
}

test('source integration can be ready while genuine provider/device acceptance stays pending', () => {
  const candidate = fixture();
  const report = reportAcceptance(candidate.input, candidate.options);
  assert.equal(report.sourceIntegrationReady, true);
  assert.equal(report.categories.implemented.status, 'pinned-source-verified');
  assert.equal(report.categories.tested.status, 'saved-fixture-pass-not-rerun');
  assert.equal(report.actualAcceptance.status, 'pending');
  assert.equal(report.actualAcceptance.liveMutationsAllowed, false);
  assert.equal(Object.hasOwn(report, 'fullCompletion'), false);
  assert.match(report.statusText, /not genuine PiggyVest delivery/);
  assert.match(report.scope, /not-whole-product/);
});

test('empty or partial evidence never implies source readiness', () => {
  const candidate = fixture();
  for (const evidence of [
    [],
    candidate.input.evidence.slice(0, 1),
    candidate.input.evidence.slice(1),
  ]) {
    const report = reportAcceptance(
      { schemaVersion: 1, evidence },
      candidate.options
    );
    assert.equal(report.sourceIntegrationReady, false);
    assert.equal(report.actualAcceptance.status, 'pending');
  }
});

test('missing files, digest drift and unlisted changed source refuse readiness', () => {
  for (const path of ['result.json', 'SOURCE-SHA256SUMS', 'module-0.mjs']) {
    const candidate = fixture();
    candidate.files.set(`${candidate.base}/${path}`, Buffer.from('changed'));
    assert.equal(
      reportAcceptance(candidate.input, candidate.options)
        .sourceIntegrationReady,
      false
    );
    candidate.files.delete(`${candidate.base}/${path}`);
    assert.equal(
      reportAcceptance(candidate.input, candidate.options)
        .sourceIntegrationReady,
      false
    );
  }
});

test('pinned result cannot claim provider delivery, live writes or push success', () => {
  for (const flag of [
    'providerPayoutVerified',
    'deviceReceiptVerified',
    'liveWritesPerformed',
    'pushSendPerformed',
  ]) {
    const candidate = fixture((result) => {
      result[flag] = true;
    });
    const report = reportAcceptance(candidate.input, candidate.options);
    assert.equal(report.sourceIntegrationReady, false);
    assert.equal(report.actualAcceptance.status, 'pending');
  }
});

test('duplicate or escaping sealed source entries refuse readiness even with repinned result', () => {
  for (const name of ['module-1.mjs', '../module-0.mjs']) {
    const candidate = fixture();
    const manifestPath = `${candidate.base}/SOURCE-SHA256SUMS`;
    const lines = candidate.files
      .get(manifestPath)
      .toString('utf8')
      .trim()
      .split('\n');
    lines[0] = `${sha256(candidate.files.get(`${candidate.base}/module-0.mjs`))}  ${name}`;
    const manifest = Buffer.from(`${lines.join('\n')}\n`);
    candidate.files.set(manifestPath, manifest);
    candidate.input.evidence[0].sha256 = sha256(manifest);
    const resultPath = `${candidate.base}/result.json`;
    const result = JSON.parse(candidate.files.get(resultPath).toString('utf8'));
    result.harnessSource.sha256 = sha256(manifest);
    candidate.files.set(resultPath, Buffer.from(JSON.stringify(result)));
    candidate.input.evidence[1].sha256 = sha256(
      candidate.files.get(resultPath)
    );
    assert.equal(
      reportAcceptance(candidate.input, candidate.options)
        .sourceIntegrationReady,
      false
    );
  }
});

test('wrong economics, duplicate credit or missing test outcome refuse fixture success', () => {
  const changes = [
    (result) => {
      result.netKobo = 814;
    },
    (result) => {
      result.snapshot.payoutEconomics.tax = 0;
    },
    (result) => {
      result.snapshot.principalKobo = 0;
    },
    (result) => {
      result.snapshot.interestReceipts = 2;
    },
    (result) => {
      result.snapshot.deliveries = 1;
    },
    (result) => {
      result.applicationOutcomes.applied = 2;
    },
    (result) => {
      delete result.validation;
    },
    (result) => {
      result.harnessSource.sha256 = 'b'.repeat(64);
    },
    (result) => {
      result.observedAt = 'not-a-time';
    },
  ];
  for (const change of changes) {
    const candidate = fixture(change);
    assert.equal(
      reportAcceptance(candidate.input, candidate.options)
        .sourceIntegrationReady,
      false
    );
  }
});

test('historical missing-evidence and stale handoffs are attachments, never current proofs', () => {
  const candidate = fixture();
  for (const category of [
    'liveAuth',
    'financial',
    'genuineProvider',
    'device',
  ]) {
    const path = `tools/staging/old-${category}.json`;
    const bytes = Buffer.from(
      JSON.stringify({ observedAt: '2026-09-27T00:00:00Z', verified: true })
    );
    candidate.files.set(path, bytes);
    candidate.input.evidence.push({
      id: `old-${category.toLowerCase()}`,
      category,
      kind: 'historical-note',
      path,
      sha256: sha256(bytes),
    });
  }
  const report = reportAcceptance(candidate.input, candidate.options);
  for (const category of [
    'liveAuth',
    'financial',
    'genuineProvider',
    'device',
  ]) {
    assert.equal(
      report.categories[category].status,
      'pending-independent-current-verification'
    );
  }
  assert.equal(report.sourceIntegrationReady, true);
  assert.equal(report.actualAcceptance.status, 'pending');
});

test('preserves r8/r2 separation, exact goal, deadline and global budget without live assertions', () => {
  const candidate = fixture();
  const report = reportAcceptance(candidate.input, candidate.options);
  assert.equal(report.constraints.deadline, '2026-10-06T15:59:10Z');
  assert.equal(report.constraints.oldPrincipalKobo, 10000);
  assert.equal(report.constraints.globalCompanySandboxBudgetKobo, 10000);
  assert.equal(
    report.constraints.emptyGoalId,
    '9f01153c-1589-4dde-b9aa-8f644a846832'
  );
  assert.equal(
    report.constraints.interestEnabledProviderWalletId,
    '01M3W0Y93XHJY9RPQ2G75X81WG'
  );
  assert.equal(report.parentContext.financialR8, 'reported-active');
  assert.match(report.parentContext.publicGateR2, /reported-failed/);
  assert.match(report.statusText, /no per-wallet split/);
  assert.match(report.statusText, /connected-phone/);
});
