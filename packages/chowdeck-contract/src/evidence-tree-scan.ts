import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, opendir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEvidenceManifest } from './evidence-schema';
import { hasPrivateHost } from './has-private-host';
import { coreEvidenceChapterSchema } from './schemas/core-evidence-chapters';
import { coreObservationManifestSchema } from './schemas/core-observation-manifest';
import { coreObservationSchema } from './schemas/core-read-observation';
import { parseStrictJson } from './strict-json-parser';

const MAX_FILES = 128;
const MAX_FILE_BYTES = 1_048_576;
const UNSAFE_KEY =
  /^(?:merchant_?reference|vendor_?id|domain|authorization|api_?key|credential|email|headers?|password|postman_?environment|raw_?(?:body|headers?|response)|secret|token)$/i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const CREDENTIAL = /(?:bearer\s+|sk[_-]|api[_-]?key\s*[:=])[^\s]{8,}/i;
const SENSITIVE_ASSIGNMENT =
  /\b(?:password|secret|token|api[_-]?key|merchant[_-]?reference|vendor[_-]?id)["']?\s*[:=]\s*["']?[^\s]+/i;

function unsafe(): never {
  throw new Error('Unsafe evidence tree');
}

function scanValue(value: unknown): void {
  if (typeof value === 'string') {
    if (
      EMAIL.test(value) ||
      CREDENTIAL.test(value) ||
      SENSITIVE_ASSIGNMENT.test(value) ||
      hasPrivateHost(value)
    )
      unsafe();
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) scanValue(entry);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (UNSAFE_KEY.test(key)) unsafe();
    scanValue(key);
    scanValue(entry);
  }
}

async function evidenceFiles(
  directory: string,
  depth = 0,
  budget = { entries: 0 }
): Promise<string[]> {
  if (depth > 32) unsafe();
  const entries = await opendir(directory);
  const files: string[] = [];
  for await (const entry of entries) {
    if (++budget.entries > 256) unsafe();
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      files.push(...(await evidenceFiles(path, depth + 1, budget)));
    else if (
      entry.isFile() &&
      (entry.name.endsWith('.json') || entry.name.endsWith('.md'))
    )
      files.push(path);
    else unsafe();
    if (files.length > MAX_FILES) unsafe();
  }
  return files;
}

export async function scanEvidenceTree(
  directory: string | URL
): Promise<{ filesScanned: number; findings: 0 }> {
  try {
    const files = await evidenceFiles(
      directory instanceof URL ? fileURLToPath(directory) : directory
    );
    for (const path of files) {
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      let content: string;
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_FILE_BYTES) unsafe();
        const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await handle.read(
            bytes,
            offset,
            bytes.length - offset,
            null
          );
          if (result.bytesRead === 0) break;
          offset += result.bytesRead;
        }
        if (offset > MAX_FILE_BYTES) unsafe();
        content = bytes.subarray(0, offset).toString('utf8');
      } finally {
        await handle.close();
      }
      const name = basename(path);
      if (name === 'README.md') {
        if (
          createHash('sha256').update(content).digest('hex') !==
          '5d67b9ec0673cdb0d67497e5816de67052aee7ecdeb59fcce93fa5fbe9324042'
        )
          unsafe();
      } else {
        const value = parseStrictJson(content);
        scanValue(value);
        if (name === 'public-contract.json') parseEvidenceManifest(value);
        else if (name === 'manifest.json')
          coreObservationManifestSchema.parse(value);
        else if (name === 'live-read-observation.json')
          coreObservationSchema.parse(value);
        else if (
          [
            'account-read.json',
            'menu-groups-items.json',
            'error-pagination-limits.json',
          ].includes(name)
        ) {
          const parsed = coreEvidenceChapterSchema.parse(value);
          if (parsed.chapter !== `0A-core/${name.slice(0, -5)}`) unsafe();
        } else unsafe();
      }
    }
    return { filesScanned: files.length, findings: 0 };
  } catch {
    return unsafe();
  }
}
