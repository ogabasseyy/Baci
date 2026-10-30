import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunMode } from './constants';
import { renderJson, renderMarkdown } from './evidence';
import type { Redactor } from './redactor';
import { HarnessRefusal } from './safety-guards';
import type { EvidenceDocument } from './types';

export interface WrittenEvidence {
  markdownPath: string;
  jsonPath: string;
}

/**
 * Only the live modes may write evidence. The rendered text is scanned
 * before anything touches disk, files are created exclusively (never
 * overwritten), and the name is derived from a validated date only.
 */
export function writeEvidence(input: {
  mode: RunMode;
  doc: EvidenceDocument;
  redactor: Redactor;
  dir: string;
}): WrittenEvidence {
  const { mode, doc, redactor, dir } = input;
  if (mode === 'dry-run') {
    throw new HarnessRefusal(
      'EVIDENCE_WRITE_FORBIDDEN',
      'dry-run never writes evidence files'
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.date)) {
    throw new HarnessRefusal(
      'EVIDENCE_WRITE_FORBIDDEN',
      'evidence date is malformed'
    );
  }
  const markdown = renderMarkdown(doc);
  const json = renderJson(doc);
  redactor.assertClean(markdown);
  redactor.assertClean(json);

  mkdirSync(dir, { recursive: true });
  let suffix = 1;
  const names = () => {
    const stem = suffix === 1 ? doc.date : `${doc.date}-${suffix}`;
    return {
      md: path.join(dir, `${stem}.md`),
      json: path.join(dir, `${stem}.json`),
    };
  };
  while (existsSync(names().md) || existsSync(names().json)) suffix += 1;
  const { md, json: jsonPath } = names();
  writeFileSync(md, markdown, { flag: 'wx', mode: 0o644 });
  writeFileSync(jsonPath, json, { flag: 'wx', mode: 0o644 });
  return { markdownPath: md, jsonPath };
}
