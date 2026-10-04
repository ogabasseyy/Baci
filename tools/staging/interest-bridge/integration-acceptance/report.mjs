import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acceptanceContract } from './constants.mjs';
import { acceptanceSchema } from './schemas/acceptance-schema.mjs';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function localReader(root) {
  const canonicalRoot = realpathSync(root);
  return (path) => {
    const filename = realpathSync(resolve(canonicalRoot, path));
    const suffix = relative(canonicalRoot, filename);
    if (suffix === '..' || suffix.startsWith('../')) {
      throw new Error('Evidence escapes local repository');
    }
    return readFileSync(filename);
  };
}

function checkSource(entry, bytes, read) {
  const lines = bytes.toString('utf8').trim().split('\n');
  if (lines.length !== 25)
    throw new Error('Expected the sealed 25-file harness');
  const names = new Set();
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) {2}([a-z0-9.-]+\.(?:mjs|sql))$/.exec(line);
    if (!match || names.has(match[2]))
      throw new Error('Invalid source manifest');
    names.add(match[2]);
    const path = `${dirname(entry.path)}/${match[2]}`;
    if (digest(read(path)) !== match[1])
      throw new Error('Source digest mismatch');
  }
  return { fileCount: lines.length, manifestSha256: entry.sha256 };
}

function checkFixture(bytes) {
  const result = JSON.parse(bytes.toString('utf8'));
  const snapshot = result.snapshot;
  if (
    result.label !==
      'synthetic-disposable-source-contract-e2e-not-provider-payout' ||
    result.providerPayoutVerified !== false ||
    result.deviceReceiptVerified !== false ||
    result.liveWritesPerformed !== false ||
    result.pushSendPerformed !== false ||
    result.grossKobo !== 814 ||
    result.taxKobo !== 81 ||
    result.netKobo !== 733 ||
    snapshot?.principalKobo !== 10000 ||
    snapshot.paidInterestKobo !== 733 ||
    snapshot.interestReceipts !== 1 ||
    snapshot.allocations !== 1 ||
    snapshot.notifications !== 1 ||
    snapshot.deliveries !== 0 ||
    snapshot.payoutEconomics?.gross !== 814 ||
    snapshot.payoutEconomics?.tax !== 81 ||
    snapshot.payoutEconomics?.net !== 733 ||
    result.applicationOutcomes?.applied !== 1 ||
    result.applicationOutcomes?.duplicate !== 10 ||
    result.applicationOutcomes?.deferred !== 1 ||
    result.applicationOutcomes?.conflict !== 1 ||
    result.validation?.contractTests !== 24 ||
    result.validation?.ownedClustersRemaining !== 0 ||
    result.harnessSource?.fileCount !== 25 ||
    !/^[a-f0-9]{64}$/.test(result.harnessSource?.sha256) ||
    result.sourceManifest?.sourceCount !== 48 ||
    !/^[a-f0-9]{64}$/.test(result.sourceManifest?.sha256) ||
    !Number.isFinite(Date.parse(result.observedAt))
  ) {
    throw new Error(
      'Saved fixture does not establish the bounded contract result'
    );
  }
  return {
    observedAt: result.observedAt,
    contractTests: 24,
    grossKobo: 814,
    taxKobo: 81,
    netKobo: 733,
    creditedOnce: true,
    harnessSha256: result.harnessSource.sha256,
    applicationSourceClosure: {
      ...result.sourceManifest,
      status: 'historical-digest-only-no-48-input-list-currently-reverified',
    },
  };
}

export function reportAcceptance(input, { root, read = localReader(root) }) {
  const parsed = acceptanceSchema.parse(input);
  const evidence = parsed.evidence.map((entry) => {
    try {
      const bytes = read(entry.path);
      if (digest(bytes) !== entry.sha256)
        throw new Error('Evidence digest mismatch');
      const detail =
        entry.kind === 'source-manifest'
          ? checkSource(entry, bytes, read)
          : entry.kind === 'synthetic-result'
            ? checkFixture(bytes)
            : null;
      return { ...entry, integrity: 'verified-local-bytes', detail };
    } catch {
      return {
        ...entry,
        integrity: 'unverified-missing-invalid-or-drifted',
        detail: null,
      };
    }
  });
  const sources = evidence.filter((entry) => entry.category === 'implemented');
  const tests = evidence.filter((entry) => entry.category === 'tested');
  const implemented =
    sources.length > 0 && sources.every((entry) => entry.detail);
  const tested =
    tests.length > 0 &&
    tests.every(
      (entry) =>
        entry.detail &&
        sources.some(
          (source) =>
            source.detail?.manifestSha256 === entry.detail.harnessSha256
        )
    );
  const sourceIntegrationReady = Boolean(implemented && tested);
  const categories = Object.fromEntries(
    Object.keys(acceptanceContract.categories).map((category) => [
      category,
      {
        status:
          category === 'implemented'
            ? implemented
              ? 'pinned-source-verified'
              : 'pending'
            : category === 'tested'
              ? tested
                ? 'saved-fixture-pass-not-rerun'
                : 'pending'
              : 'pending-independent-current-verification',
        evidenceIds: evidence
          .filter((entry) => entry.category === category)
          .map((entry) => entry.id),
      },
    ])
  );
  const sourceText = sourceIntegrationReady
    ? 'The pinned source contract integration is ready on saved test evidence: real disposable PostgreSQL, HMAC/AES-GCM and replay credited gross814/tax81/net733 once in a synthetic fixture (24 tests reported).'
    : 'Source integration readiness is pending: required pinned implementation/test evidence is missing, invalid or drifted.';
  return {
    schemaVersion: 1,
    mode: parsed.mode,
    scope:
      'bounded-pinned-contract-harness-not-whole-product-or-current-application-closure',
    sourceIntegrationReady,
    actualAcceptance: {
      status: 'pending',
      verification: 'not-performed-by-source-only-reporter',
      providerPayout: 'pending-genuine-delivery-not-fixture',
      deviceReceipt: 'pending-physical-device-verification',
      liveMutationsAllowed: false,
    },
    constraints: {
      deadline: acceptanceContract.deadline,
      oldPrincipalKobo: acceptanceContract.oldPrincipalKobo,
      globalCompanySandboxBudgetKobo:
        acceptanceContract.globalCompanySandboxBudgetKobo,
      emptyGoalId: acceptanceContract.emptyGoalId,
      interestEnabledProviderWalletId:
        acceptanceContract.interestEnabledProviderWalletId,
    },
    parentContext: acceptanceContract.parentContext,
    categories,
    evidence,
    pending: acceptanceContract.pending,
    statusText: `${sourceText} This is not genuine PiggyVest delivery. Live auth/financial acceptance still requires independent current proofs. Parent reports financial r8 active, public r2 failed with read-only recovery verified and no financial change; that repair is separate. Old principal and global company sandbox budget remain 10,000 kobo each per parent context. The new empty interest-enabled goal has no payout namespace policy. Provider confirms global customer9/business3 dashboard terms only; no per-wallet split or genuine sandbox monthly payout test is available. Native staging pins, signing/EAS and connected-phone receipt checks remain pending. Actual integration acceptance is pending; no production readiness is claimed.`,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const directory = dirname(fileURLToPath(import.meta.url));
    const input = JSON.parse(
      readFileSync(resolve(directory, 'evidence.json'), 'utf8')
    );
    const report = reportAcceptance(input, {
      root: resolve(directory, '../../../..'),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.sourceIntegrationReady ? 0 : 1;
  } catch {
    process.stderr.write(
      'Acceptance input refused; no acceptance established.\n'
    );
    process.exitCode = 1;
  }
}
