import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

/** Names tried before giving up (`<date>`, `<date>-2`, ...). */
const MAX_NAME_ATTEMPTS = 100;

type CreateFile = (file: string, text: string) => void;

/** Creates the file, failing with EEXIST if it is already there. */
const createExclusive: CreateFile = (file, text) =>
  writeFileSync(file, text, { flag: 'wx', mode: 0o644 });

const nameTaken = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'EEXIST';

/**
 * Only the live modes may write evidence. The rendered text is scanned
 * before anything touches disk, files are created exclusively (never
 * overwritten) and the name is derived from a validated date only. There is
 * no existence check to race: the exclusive create itself decides, and a
 * name that turns out to be taken moves on to the next suffix.
 */
export function writeEvidence(input: {
  mode: RunMode;
  doc: EvidenceDocument;
  redactor: Redactor;
  dir: string;
  /** Test seam for the exclusive create; defaults to an `wx` write. */
  createFile?: CreateFile;
}): WrittenEvidence {
  const { mode, doc, redactor, dir } = input;
  const createFile = input.createFile ?? createExclusive;
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
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const stem = attempt === 1 ? doc.date : `${doc.date}-${attempt}`;
    const markdownPath = path.join(dir, `${stem}.md`);
    const jsonPath = path.join(dir, `${stem}.json`);
    try {
      createFile(markdownPath, markdown);
    } catch (error) {
      if (nameTaken(error)) continue;
      throw error;
    }
    try {
      createFile(jsonPath, json);
      return { markdownPath, jsonPath };
    } catch (error) {
      // The markdown was created a moment ago by this call: never leave half a pair.
      rmSync(markdownPath, { force: true });
      if (nameTaken(error)) continue;
      throw error;
    }
  }
  throw new HarnessRefusal(
    'EVIDENCE_WRITE_FORBIDDEN',
    `no free evidence file name after ${MAX_NAME_ATTEMPTS} attempts`
  );
}
