import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpsOpenRequest } from '@/schemas/piggyvest/ops-open-request-row';
import { type ApproveDeps, main } from './approve';
import {
  type ApproverConnectionConfig,
  type ApproverSession,
  OpsRefusal,
} from './approve-db';

const REQUEST_ID = '3f0e0000-0000-4000-8000-000000000001';
const open: OpsOpenRequest = {
  requestId: REQUEST_ID,
  action: 'treasury_sweep',
  label: 'Move Collection wallet money to the Ogabassey bank account',
  subject:
    'piggyvest_primary.wallet_transfers:0a0e0000-0000-4000-8000-000000000001',
  amountKobo: 1_500_000,
  destination: 'Bank 058 ••••6789 "Ogabassey GTBank"',
  reason: 'Vendor float top-up',
  requestedBy: 'pv_ops_tunde',
  openedAt: new Date('2026-10-31T10:00:00Z'),
  expiresAt: new Date('2026-11-01T10:00:00Z'),
  approvals: 1,
  decidedByYou: false,
  digest: 'd'.repeat(64),
};
const base = [
  '--host',
  'db.example.supabase.co',
  '--user',
  'pv_approver_amaka',
];

function harness(
  options: {
    rows?: OpsOpenRequest[];
    typedAmount?: string;
    password?: string;
    interactive?: boolean;
    decide?: ApproverSession['decide'];
  } = {}
) {
  const out: string[] = [];
  const err: string[] = [];
  const configs: ApproverConnectionConfig[] = [];
  const decide = vi.fn(
    options.decide ??
      (async () => ({
        requestId: REQUEST_ID,
        decision: 'approve' as const,
        approvals: 2,
        state: 'open' as const,
      }))
  );
  const close = vi.fn(async () => undefined);
  const promptHidden = vi.fn(async () => options.password ?? 'typed-secret');
  const promptLine = vi.fn(async () => options.typedAmount ?? '15,000.00');
  const connect = vi.fn(async (config: ApproverConnectionConfig) => {
    configs.push(config);
    return { listOpen: async () => options.rows ?? [open], decide, close };
  });
  const deps: ApproveDeps = {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    isInteractive: () => options.interactive ?? true,
    promptHidden,
    promptLine,
    readCertificate: async () => 'CA PEM',
    connect,
  };
  return {
    deps,
    out,
    err,
    configs,
    decide,
    close,
    promptHidden,
    promptLine,
    connect,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('approve CLI', () => {
  it('is a dry run by default: shows the summary and records nothing', async () => {
    const h = harness();
    const code = await main([...base, '--request', REQUEST_ID], h.deps);
    expect(code).toBe(0);
    expect(h.decide).not.toHaveBeenCalled();
    const text = h.out.join('\n');
    expect(text).toContain('₦15,000.00');
    expect(text).toContain('••••6789');
    expect(text).toContain('Dry run: nothing was recorded');
    expect(h.close).toHaveBeenCalled();
  });

  it('aborts on a mistyped amount and records nothing', async () => {
    const h = harness({ typedAmount: '150,000.00' });
    const code = await main(
      [...base, '--request', REQUEST_ID, '--commit'],
      h.deps
    );
    expect(code).toBe(1);
    expect(h.decide).not.toHaveBeenCalled();
    expect(h.err.join('\n')).toContain(
      'The amount you typed does not match. Nothing was recorded.'
    );
  });

  it('stops cleanly when the terminal closes before the amount is retyped', async () => {
    const h = harness();
    h.promptLine.mockRejectedValueOnce(new Error('Input closed'));
    const code = await main(
      [...base, '--request', REQUEST_ID, '--commit'],
      h.deps
    );
    expect(code).toBe(1);
    expect(h.decide).not.toHaveBeenCalled();
    expect(h.err.join('\n')).toContain('Cancelled. Nothing was recorded.');
    expect(h.close).toHaveBeenCalled();
  });

  it('records the approval with the confirmed amount and digest on --commit', async () => {
    const h = harness();
    const code = await main(
      [...base, '--request', REQUEST_ID, '--commit'],
      h.deps
    );
    expect(code).toBe(0);
    expect(h.decide).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      decision: 'approve',
      amountKobo: 1_500_000,
      digest: open.digest,
    });
    expect(h.out.join('\n')).toContain('Recorded your approval');
  });

  it('records a rejection with --reject --commit', async () => {
    const h = harness({
      decide: async () => ({
        requestId: REQUEST_ID,
        decision: 'reject',
        approvals: 1,
        state: 'rejected',
      }),
    });
    const code = await main(
      [...base, '--request', REQUEST_ID, '--reject', '--commit'],
      h.deps
    );
    expect(code).toBe(0);
    expect(h.decide.mock.calls[0][0].decision).toBe('reject');
  });

  it('never takes the password from argv: refused before any prompt or connection', async () => {
    const h = harness();
    const code = await main([...base, '--password', 'hunter2'], h.deps);
    expect(code).toBe(2);
    expect(h.promptHidden).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('never takes the password from the environment: only the hidden prompt counts', async () => {
    vi.stubEnv('PGPASSWORD', 'from-environment');
    vi.stubEnv('PIGGYVEST_APPROVER_PASSWORD', 'from-environment');
    const h = harness({ password: 'typed-secret' });
    await main(base, h.deps);
    expect(h.promptHidden).toHaveBeenCalledWith(
      'Password for pv_approver_amaka: '
    );
    expect(h.configs[0].password).toBe('typed-secret');
    expect(h.configs[0].ssl).toEqual({ rejectUnauthorized: true });
  });

  it('refuses to run without an interactive terminal', async () => {
    const h = harness({ interactive: false });
    expect(await main(base, h.deps)).toBe(2);
    expect(h.promptHidden).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('refuses an empty password without connecting', async () => {
    const h = harness({ password: '' });
    expect(await main(base, h.deps)).toBe(2);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('stops with a clear message when the CA file cannot be read', async () => {
    const h = harness();
    h.deps.readCertificate = async () => {
      throw new Error('ENOENT');
    };
    expect(await main([...base, '--ca', '/missing/ca.crt'], h.deps)).toBe(2);
    expect(h.err.join('\n')).toContain(
      'Could not read the CA certificate file'
    );
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('ends cleanly when the password prompt is cancelled', async () => {
    const h = harness();
    h.promptHidden.mockRejectedValueOnce(new Error('Cancelled'));
    expect(await main(base, h.deps)).toBe(2);
    expect(h.err.join('\n')).toContain('Cancelled. Nothing was done.');
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('lists open requests when no request is given', async () => {
    const h = harness();
    expect(await main(base, h.deps)).toBe(0);
    expect(h.promptLine).not.toHaveBeenCalled();
    expect(h.out.join('\n')).toContain(REQUEST_ID);
  });

  it.each([
    ['a request not open for this approver', { rows: [] }],
    ['a request already decided', { rows: [{ ...open, decidedByYou: true }] }],
  ])('stops on %s without asking for the amount', async (_label, options) => {
    const h = harness(options);
    const code = await main(
      [...base, '--request', REQUEST_ID, '--commit'],
      h.deps
    );
    expect(code).toBe(1);
    expect(h.promptLine).not.toHaveBeenCalled();
    expect(h.decide).not.toHaveBeenCalled();
  });

  it('explains a database refusal in plain words', async () => {
    const h = harness({
      decide: async () => {
        throw new OpsRefusal('ops_approval_requester_cannot_approve');
      },
    });
    const code = await main(
      [...base, '--request', REQUEST_ID, '--commit'],
      h.deps
    );
    expect(code).toBe(1);
    expect(h.err.join('\n')).toContain('You opened this request');
    expect(h.close).toHaveBeenCalled();
  });

  it('treats a lost reply after sending a decision as unknown, never as nothing recorded', async () => {
    const h = harness({
      decide: async () => {
        throw new Error('The database could not complete the request.');
      },
    });
    const code = await main(
      [...base, '--request', REQUEST_ID, '--commit'],
      h.deps
    );
    expect(code).toBe(1);
    const text = h.err.join('\n');
    expect(text).toContain('may or may not have been recorded');
    expect(text).not.toContain('Nothing was recorded');
  });

  it('does not read the environment anywhere in the tool', () => {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    for (const file of readdirSync(directory)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const source = readFileSync(path.join(directory, file), 'utf8');
      expect(source, file).not.toMatch(/process\.env|PGPASSWORD|pgpass/);
    }
  });
});
