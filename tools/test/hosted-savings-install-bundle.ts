import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z
  .object({
    format: z.literal(1),
    mode: z.literal('materialize-only'),
    baseSha: z.string(),
    ordering: z.literal(
      'existing chronological materializer then existing current-tree replacement applier'
    ),
    bootstrapCount: z.literal(125),
    inputs: z.array(z.unknown()),
    entries: z
      .array(
        z
          .object({
            ordinal: z.number().int().positive(),
            stage: z.enum(['bootstrap', 'historical', 'current-tree']),
            source: z
              .string()
              .regex(/^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/),
            sourceSha256: sha,
            transform: z.unknown(),
            file: z.string().regex(/^sql\/\d+-\d{14}_[a-z0-9_]+\.sql$/),
            sha256: sha,
            bytes: z
              .number()
              .int()
              .positive()
              .max(8 * 1024 * 1024),
          })
          .strict()
      )
      .min(125)
      .max(5000),
    auditSha256: sha,
    executionAuthorized: z.literal(false),
    resumeSupported: z.literal(false),
  })
  .strict();
const hash = (value: Buffer) =>
  createHash('sha256').update(value).digest('hex');

export async function readHostedSavingsInstallBundle(
  directory: string,
  expectedHash: string
) {
  const root = await realpath(directory);
  const safeRead = async (file: string, limit: number) => {
    const target = path.join(root, file);
    const resolved = await realpath(target);
    const metadata = await lstat(target);
    if (resolved !== target || !metadata.isFile() || metadata.size > limit)
      throw new Error('Unsafe bundle file');
    return readFile(target);
  };
  const bytes = await safeRead('manifest.json', 8 * 1024 * 1024);
  if (hash(bytes) !== expectedHash)
    throw new Error('Reviewed manifest hash mismatch');
  const manifest = schema.parse(JSON.parse(bytes.toString()));
  if (
    hash(await safeRead('audit.json', 16 * 1024 * 1024)) !==
    manifest.auditSha256
  )
    throw new Error('Audit hash mismatch');
  let total = 0;
  const entries = [];
  for (const [index, entry] of manifest.entries.entries()) {
    if (
      entry.ordinal !== index + 1 ||
      entry.file !== `sql/${index + 1}-${path.basename(entry.source)}` ||
      (entry.stage === 'bootstrap') !== index < 125
    )
      throw new Error('Bundle ordering mismatch');
    const sql = await safeRead(entry.file, 8 * 1024 * 1024);
    total += sql.length;
    if (
      total > 64 * 1024 * 1024 ||
      sql.length !== entry.bytes ||
      hash(sql) !== entry.sha256
    )
      throw new Error('SQL bundle hash mismatch');
    if (
      /^\s*\\/m.test(sql.toString()) ||
      /\bCOPY\b[^;]*\bPROGRAM\b/i.test(sql.toString())
    )
      throw new Error('Executable client directive forbidden');
    entries.push({ ...entry, sql: sql.toString() });
  }
  return { manifestSha256: expectedHash, entries };
}
