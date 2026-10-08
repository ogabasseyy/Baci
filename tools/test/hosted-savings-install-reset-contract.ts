import { z } from 'zod';
import { hostedSavingsInstallContract } from './hosted-savings-install-contract';
import { planHostedSavingsInstallRecovery } from './hosted-savings-install-recovery';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const backup = z.object({ path: z.string().startsWith('/'), bytes: z.number().int().positive().max(2_000_000), sha256: digest }).strict();
const schema = z.object({
  version: z.literal(1),
  parentReviewedCurrentStateReset: z.literal(true),
  databaseArchiveListVerified: z.literal(true),
  globalsBackupVerified: z.literal(true),
  currentReceipt: hostedSavingsInstallContract,
  failedReceipt: z.unknown(),
  metadata: z.unknown(),
  systemIdentifier: z.literal('7685172624138473505'),
  volumeIdentitySha256: digest,
  publicComment: z.string().max(10000).nullable(),
  databaseArchive: backup,
  globalsArchive: backup,
}).strict();

export function parseHostedSavingsResetReview(value: unknown) {
  const review = schema.parse(value);
  const recovery = planHostedSavingsInstallRecovery(review.currentReceipt, review.failedReceipt, review.metadata);
  if (recovery.manifestSha256 !== '0546896a24a17138b207da860d3b97d4baa35bdca4516645605043f12c1fb90f' ||
    review.databaseArchive.bytes !== 567963 || review.databaseArchive.sha256 !== '22ac05c4a15a319c75de4c563c432154f0e504d0b7625526c4542e326814afc5' ||
    review.globalsArchive.bytes !== 4405 || review.globalsArchive.sha256 !== '19991c49b1337c0a2e0ada7f297f3f28470e21796f61d7cfe58cf120f31430fe' ||
    recovery.backupSha256 !== review.databaseArchive.sha256)
    throw new Error('Wrong reviewed bundle or backup evidence');
  const metadata = review.metadata as { lineage?: {currentSystemIdentifier: string; currentVolumeIdentitySha256: string} };
  if (metadata.lineage && (metadata.lineage.currentSystemIdentifier !== review.systemIdentifier || metadata.lineage.currentVolumeIdentitySha256 !== review.volumeIdentitySha256))
    throw new Error('Recovery lineage differs from execution identity');
  return review;
}
