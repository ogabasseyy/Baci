import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEvidence, renderJson, renderMarkdown } from './evidence';
import { HarnessRefusal } from './safety-guards';
import type { ProofResult } from './types';

const proof = (overrides: Partial<ProofResult> = {}): ProofResult => ({
  proof: 'p1',
  title: 'Create-customer re-POST | with returnIfExist',
  status: 'observed',
  findings: [
    {
      id: 'f1',
      question: 'Same wallet?',
      answer: 'yes',
      detail: 'baseline: create | response',
    },
  ],
  shapes: [
    {
      name: 'POST /customers',
      httpStatus: 200,
      fields: [{ path: 'wallet_id', type: 'string(ulid)' }],
    },
  ],
  values: { count: 2, flag: true, note: null },
  notes: ['a note'],
  ...overrides,
});

const doc = (
  proofs: ProofResult[] = [proof()],
  over: {
    mode?: 'dry-run' | 'live-readonly' | 'live-sandbox-mutations';
    mockData?: boolean;
  } = {}
) =>
  buildEvidence({
    date: '2026-10-30',
    mode: over.mode ?? 'live-readonly',
    mockData: over.mockData ?? false,
    proofs,
  });

function _code(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}
const _tempDir = () =>
  path.join(
    mkdtempSync(path.join(tmpdir(), 'pvb-evidence-')),
    'docs',
    'evidence'
  );

describe('renderMarkdown / renderJson', () => {
  it('renders summary, findings, values, shapes, notes and the assumptions list', () => {
    const md = renderMarkdown(doc());
    expect(md).toContain('# PiggyVest sandbox contract evidence: 2026-10-30');
    expect(md).toContain('staging.piggyvest.business');
    expect(md).toContain('| p1 |');
    expect(md).toContain('wallet_id');
    expect(md).toContain('string(ulid)');
    expect(md).toContain('## Assumptions the live run must confirm');
    expect(md).toContain('a note');
  });

  it('escapes pipes so cells cannot break the tables', () => {
    const md = renderMarkdown(doc());
    expect(md).toContain('create \\| response');
    expect(md).toContain('re-POST \\| with returnIfExist');
  });

  it('labels dry-run output as mock data, never as evidence', () => {
    const md = renderMarkdown(
      doc([proof()], { mode: 'dry-run', mockData: true })
    );
    expect(md).toMatch(/MOCK DATA/);
    expect(md).toMatch(/not evidence/i);
    expect(renderMarkdown(doc())).not.toMatch(/MOCK DATA/);
  });

  it('emits machine-readable JSON with the same proofs', () => {
    const parsed = JSON.parse(renderJson(doc()));
    expect(parsed.schema).toBe('piggyvest-contract-evidence/v1');
    expect(parsed.proofs[0].findings[0].answer).toBe('yes');
    expect(parsed.mode).toBe('live-readonly');
  });

  it('carries the active safety guards in the document', () => {
    expect(doc().guards.join(' ')).toMatch(/staging\.piggyvest\.business/);
  });
});
