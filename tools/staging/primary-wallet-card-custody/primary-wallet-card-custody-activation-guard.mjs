import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function verifyPrimaryCustodyPreparation(directory, input = {}) {
  const root = path.resolve(directory);
  const now = (input.now ?? Date.now)();
  const sealStat = await lstat(path.join(root, 'SHA256SUMS'));
  if (!sealStat.isFile() || sealStat.isSymbolicLink()) throw new Error('Invalid preparation seal');
  const seal = await readFile(path.join(root, 'SHA256SUMS'), 'utf8');
  const entries = seal.trim().split('\n');
  if (entries.length < 8 || entries.length > 40) throw new Error('Invalid preparation seal');
  const checked = new Set();
  for (const entry of entries) {
    // `@` admits the templated systemd unit assets (`baci-primary-card-custody@.service`);
    // `/` stays excluded so entries can never escape the sealed directory.
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9_.@-]+)$/.exec(entry);
    if (!match || checked.has(match[2])) throw new Error('Invalid preparation seal');
    checked.add(match[2]);
    const target = path.join(root, match[2]);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || digest(await readFile(target)) !== match[1])
      throw new Error('Prepared artifact changed');
  }
  for (const required of ['preparation.json', 'custody.cjs', 'artifact.manifest.json', 'activation-guard.mjs', 'worker-expiry.conf'])
    if (!checked.has(required)) throw new Error('Required sealed artifact missing');
  const preparation = JSON.parse(await readFile(path.join(root, 'preparation.json'), 'utf8'));
  const expires = Date.parse(preparation.expiresAt);
  const created = Date.parse(preparation.createdAt);
  if (!Number.isFinite(now) || !Number.isFinite(expires) || !Number.isFinite(created) || created > now + 5000 ||
    now >= expires || expires - created > 86400000 || preparation.activationAuthorized !== false)
    throw new Error('Preparation expired or invalid');
  const report = { sealed: true, expiresAt: preparation.expiresAt, activationAuthorized: false,
    sealSha256: digest(seal), ownerApprovalRequired: true };
  if (!input.requireOwnerApproval) return report;
  const rootStat = await lstat(root);
  const approvalPath = path.join(root, 'owner-approval.json');
  const approvalStat = await lstat(approvalPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== 0 || (rootStat.mode & 0o022) !== 0 ||
    !approvalStat.isFile() || approvalStat.isSymbolicLink() || approvalStat.uid !== 0 || (approvalStat.mode & 0o027) !== 0 ||
    sealStat.uid !== 0 || (sealStat.mode & 0o022) !== 0)
    throw new Error('Owner approval custody unavailable');
  for (const filename of checked) {
    const stat = await lstat(path.join(root, filename));
    if (stat.uid !== 0 || (stat.mode & 0o022) !== 0) throw new Error('Prepared artifact custody unavailable');
  }
  const approval = JSON.parse(await readFile(approvalPath, 'utf8'));
  if (approval.preparedSealSha256 !== report.sealSha256 || Date.parse(approval.expiresAt) > expires ||
    !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= now ||
    !['artifactInstallationApproved','schedulerStartApproved','restrictedConfigurationApproved',
      'migrationReplayVerified','operatorProviderProofVerified','rollbackApproved'].every((key) => approval[key] === true))
    throw new Error('Exact unexpired owner approvals unavailable');
  if (!preparation.operatorEvidenceReviewed) throw new Error('Operator evidence unavailable');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, directory] = process.argv.slice(2);
  if (!directory || !['--verify', '--owner-gate'].includes(mode) || process.argv.length !== 4) {
    process.stderr.write('Read-only preparation verifier requires --verify or --owner-gate and a directory\n');
    process.exitCode = 1;
  } else {
    verifyPrimaryCustodyPreparation(directory, { requireOwnerApproval: mode === '--owner-gate' }).then(
      (report) => process.stdout.write(`${JSON.stringify(report)}\n`),
      () => { process.stderr.write('Primary custody preparation verification refused\n'); process.exitCode = 1; }
    );
  }
}
