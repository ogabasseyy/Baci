import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateHostedStagingPushBuildPreparation } from './preflight.mjs';
import { AcceptanceEvidenceSchema } from './schemas/acceptance.mjs';

const DEADLINE = Date.parse('2026-10-06T15:59:10Z');

export function evaluateHostedStagingPushAcceptance({
  pins,
  profile,
  baseline,
  evidence,
  now = Date.now(),
}) {
  const preparation = evaluateHostedStagingPushBuildPreparation(
    pins,
    profile,
    baseline
  );
  const blockers = [...preparation.blockers];
  const parsed = AcceptanceEvidenceSchema.safeParse(evidence);
  if (!Number.isFinite(now) || now >= DEADLINE)
    blockers.push('staging-deadline-expired');
  if (!parsed.success) {
    blockers.push('acceptance-evidence-invalid');
  } else {
    const data = parsed.data;
    const observed = Date.parse(data.observedAt ?? '');
    if (
      !Number.isFinite(observed) ||
      observed > now ||
      now - observed > 86400000
    )
      blockers.push('fresh-observation-required');
    const native = pins?.nativeStagingPush;
    if (
      !data.project.authenticated ||
      !data.project.ownerApproved ||
      !data.project.signingApproved ||
      !data.project.inventorySha256 ||
      !native ||
      data.project.projectId !== native.projectId
    )
      blockers.push('approved-authenticated-staging-project-required');
    if (
      !data.build.buildId ||
      !data.build.platform ||
      data.build.platform !== data.device.platform ||
      data.build.projectId !== native?.projectId ||
      !data.build.artifactSha256 ||
      !data.build.nativeGeneratedFromStaging ||
      !data.build.pushCredentialsMatchStaging ||
      !preparation.manifestSha256 ||
      data.build.manifestSha256 !== preparation.manifestSha256
    )
      blockers.push('matching-signed-staging-build-required');
    const expectedId =
      data.device.platform === 'ios'
        ? native?.iosBundleIdentifier
        : native?.androidPackage;
    if (
      !data.device.physical ||
      !data.device.platform ||
      !expectedId ||
      data.device.applicationId !== expectedId ||
      !data.device.installedBuildId ||
      data.device.installedBuildId !== data.build.buildId ||
      !data.device.permissionGranted ||
      !data.device.tokenRegisteredToStaging ||
      !data.device.registrationEvidenceSha256
    )
      blockers.push('physical-staging-device-registration-required');
    if (
      !data.delivery.foreground ||
      !data.delivery.background ||
      !data.delivery.coldStartTap ||
      !data.delivery.matchingGoalOpened ||
      !data.delivery.scopedWalletQueryRefreshed ||
      !data.delivery.receiptEvidenceSha256
    )
      blockers.push('push-receipt-navigation-refresh-required');
    if (
      !data.interest.providerPaidReceiptVerified ||
      !data.interest.netAmountKobo ||
      !data.interest.paidNetCopyVerified ||
      !data.interest.earningsAndGoalRefreshed ||
      !data.interest.duplicateCreditAbsent ||
      !data.interest.receiptEvidenceSha256
    )
      blockers.push('genuine-paid-interest-evidence-required');
    if (
      !data.sample.nonProviderLabelVisible ||
      !data.sample.persistedBalancesUnchanged
    )
      blockers.push('nonprovider-sample-isolation-required');
  }
  return {
    offline: true,
    evidenceAccepted: blockers.length === 0,
    deviceAcceptanceVerified: false,
    providerPayoutVerified: false,
    buildAuthorized: false,
    parentEvidenceReviewRequired: true,
    blockers,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  let result;
  try {
    const paths = new Map();
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index += 2) {
      if (
        !['--pins', '--profile', '--evidence'].includes(args[index]) ||
        !args[index + 1] ||
        args[index + 1].startsWith('--') ||
        paths.has(args[index])
      )
        throw new Error('Invalid input');
      paths.set(args[index], args[index + 1]);
    }
    const readJson = (path) => {
      const source = readFileSync(path, 'utf8');
      if (source.length > 262144) throw new Error('Input exceeds limit');
      return JSON.parse(source);
    };
    const baseline = readJson(
      new URL(
        '../../../apps/mobile-storefront/config/hosted-storefront-pins.json',
        import.meta.url
      )
    );
    result = evaluateHostedStagingPushAcceptance({
      baseline,
      pins: paths.has('--pins') ? readJson(paths.get('--pins')) : baseline,
      profile: readJson(
        paths.get('--profile') ??
          new URL('./eas-profile.template.json', import.meta.url)
      ),
      evidence: readJson(
        paths.get('--evidence') ??
          new URL('./acceptance.template.json', import.meta.url)
      ),
    });
  } catch {
    result = {
      offline: true,
      evidenceAccepted: false,
      deviceAcceptanceVerified: false,
      providerPayoutVerified: false,
      buildAuthorized: false,
      parentEvidenceReviewRequired: true,
      blockers: ['input-invalid'],
    };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.evidenceAccepted ? 0 : 1;
}
