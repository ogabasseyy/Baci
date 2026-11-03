import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEvidence } from './evidence';
import { writeEvidence } from './evidence-writer';
import { Redactor } from './redactor';
import { HarnessRefusal } from './safety-guards';
import { SENSITIVE } from './sensitive-fixtures.test-support';
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

function code(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}
const tempDir = () =>
  path.join(
    mkdtempSync(path.join(tmpdir(), 'pvb-evidence-')),
    'docs',
    'evidence'
  );

describe('writeEvidence', () => {
  it('refuses to write in dry-run, whatever the caller asks', () => {
    const dir = tempDir();
    expect(
      code(() =>
        writeEvidence({
          mode: 'dry-run',
          doc: doc(),
          redactor: new Redactor(),
          dir,
        })
      )
    ).toBe('EVIDENCE_WRITE_FORBIDDEN');
    expect(existsSync(dir)).toBe(false);
  });

  it.each([
    'live-readonly',
    'live-sandbox-mutations',
  ] as const)('writes <date>.md and <date>.json in %s', (mode) => {
    const dir = tempDir();
    const result = writeEvidence({
      mode,
      doc: doc(),
      redactor: new Redactor(),
      dir,
    });
    expect(path.basename(result.markdownPath)).toBe('2026-10-30.md');
    expect(path.basename(result.jsonPath)).toBe('2026-10-30.json');
    expect(readFileSync(result.markdownPath, 'utf8')).toContain(
      '# PiggyVest sandbox contract evidence'
    );
    expect(() =>
      JSON.parse(readFileSync(result.jsonPath, 'utf8'))
    ).not.toThrow();
  });

  it('never overwrites an earlier file: it picks the next free suffix', () => {
    const dir = tempDir();
    const first = writeEvidence({
      mode: 'live-readonly',
      doc: doc(),
      redactor: new Redactor(),
      dir,
    });
    const second = writeEvidence({
      mode: 'live-readonly',
      doc: doc(),
      redactor: new Redactor(),
      dir,
    });
    expect(path.basename(second.markdownPath)).toBe('2026-10-30-2.md');
    expect(path.basename(second.jsonPath)).toBe('2026-10-30-2.json');
    expect(readdirSync(dir).sort()).toEqual([
      '2026-10-30-2.json',
      '2026-10-30-2.md',
      '2026-10-30.json',
      '2026-10-30.md',
    ]);
    expect(existsSync(first.markdownPath)).toBe(true);
  });

  it.each(
    Object.entries(SENSITIVE)
  )('fails closed and writes nothing if %s reaches the output', (name, value) => {
    const dir = tempDir();
    const redactor = new Redactor();
    // Names have no recognisable pattern. They are caught because the harness
    // registers every name it reads from the provider (scenario.ts, proof 3).
    if (name === 'personName' || name === 'accountName') {
      redactor.register('N', value);
    }
    const leaky = doc([proof({ notes: [`oops ${value}`] })]);
    expect(
      code(() =>
        writeEvidence({ mode: 'live-readonly', doc: leaky, redactor, dir })
      )
    ).toBe('EVIDENCE_LEAK');
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('also blocks a leak that only appears in a shape path', () => {
    const dir = tempDir();
    const leaky = doc([
      proof({
        shapes: [
          {
            name: 'x',
            httpStatus: 200,
            fields: [{ path: SENSITIVE.uuid, type: 'string(text)' }],
          },
        ],
      }),
    ]);
    expect(
      code(() =>
        writeEvidence({
          mode: 'live-readonly',
          doc: leaky,
          redactor: new Redactor(),
          dir,
        })
      )
    ).toBe('EVIDENCE_LEAK');
  });

  it('rejects a malformed date so the path cannot be steered', () => {
    const bad = { ...doc(), date: '../../etc/passwd' };
    expect(
      code(() =>
        writeEvidence({
          mode: 'live-readonly',
          doc: bad,
          redactor: new Redactor(),
          dir: tempDir(),
        })
      )
    ).toBe('EVIDENCE_WRITE_FORBIDDEN');
  });
});

describe('writeEvidence: file contents and naming', () => {
  it('writes the rendered markdown and a JSON document that round-trips the proofs', () => {
    const dir = tempDir();
    const result = writeEvidence({
      mode: 'live-sandbox-mutations',
      doc: doc(),
      redactor: new Redactor(),
      dir,
    });
    const json = JSON.parse(readFileSync(result.jsonPath, 'utf8'));
    expect(json.proofs).toHaveLength(1);
    expect(json.date).toBe('2026-10-30');
    expect(readFileSync(result.markdownPath, 'utf8')).toContain('2026-10-30');
  });

  it('creates the evidence directory when it does not exist', () => {
    const dir = path.join(tempDir(), 'deep', 'er');
    writeEvidence({
      mode: 'live-readonly',
      doc: doc(),
      redactor: new Redactor(),
      dir,
    });
    expect(existsSync(dir)).toBe(true);
  });

  it('writes nothing for a leaking JSON-only field either (both documents are scanned)', () => {
    const dir = tempDir();
    const leaky = doc([proof({ values: { id: SENSITIVE.uuid } })]);
    expect(() =>
      writeEvidence({
        mode: 'live-readonly',
        doc: leaky,
        redactor: new Redactor(),
        dir,
      })
    ).toThrow(HarnessRefusal);
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });
});
