import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agenticDvaCutoverEvidenceTestSupport } from '@/lib/agentic/agentic-dva-cutover-evidence-test-support';
import { logger } from '@/lib/logger';
import { runAuditAgenticDvaConsentCutoverCli } from './audit-agentic-dva-consent-cutover';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

const now = new Date('2026-07-20T12:00:00.000Z');
const { claimingRow } = agenticDvaCutoverEvidenceTestSupport;

describe('runAuditAgenticDvaConsentCutoverCli', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');
  });

  it('refuses to audit while new Agentic Paystack DVA setup is enabled', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'enabled');
    const { supabase } = createAuditSupabase([]);

    await expect(
      runAuditAgenticDvaConsentCutoverCli([], supabase as never, now)
    ).resolves.toBe(1);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      'Agentic Paystack DVA must be paused before the cutover audit.'
    );
  });

  it('reports invalid DVA mode configuration separately from enabled mode', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'invalid');
    const { supabase } = createAuditSupabase([]);

    await expect(
      runAuditAgenticDvaConsentCutoverCli([], supabase as never, now)
    ).resolves.toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AGENTIC_DVA_CUTOVER_MODE_RESOLUTION_FAILED',
      })
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('reports exact counts plus bounded opaque evidence and blocks nonzero cutover', async () => {
    const row = claimingRow();
    const { chains, supabase } = createAuditSupabase([
      { count: 3, data: [row], error: null },
      { count: 0, data: [], error: null },
      { count: 0, data: [], error: null },
    ]);

    await expect(
      runAuditAgenticDvaConsentCutoverCli(
        ['--limit', '1'],
        supabase as never,
        now
      )
    ).resolves.toBe(1);

    const report = JSON.parse(
      vi.mocked(console.log).mock.calls[0][0] as string
    );
    expect(report).toMatchObject({
      limit: 1,
      mode: 'read_only',
      rollout_blocked: true,
      total_count: 3,
      transitional_counts: {
        claiming_payment: 3,
        order_finalizing: 0,
        payment_account_ready: 0,
      },
      zero_transitional_states: false,
    });
    expect(report.states.claiming_payment).toMatchObject({
      count: 3,
      truncated: true,
    });
    expect(report.states.claiming_payment.entries[0]).toMatchObject({
      disposition: 'manual_review',
      reason: 'provider_outcome_unconfirmed',
      session_id: 'agentic_session_1',
    });
    expect(
      report.states.claiming_payment.entries[0].evidence_fingerprint
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(chains[0].select).toHaveBeenCalledWith(
      expect.not.stringContaining('*'),
      { count: 'exact' }
    );
    expect(chains[0].limit).toHaveBeenCalledWith(1);
    expect(chains[2].or).toHaveBeenCalledWith(
      expect.stringContaining('pay_on_delivery')
    );
  });

  it('prints no account, buyer, merchant, or metadata values', async () => {
    const row = claimingRow({
      customer_email: 'buyer@example.com',
      customer_name: 'Secret Canary',
      customer_phone: '+2348012345678',
      metadata: {
        agentic: {
          canary: 'secret-canary',
          payment_state: 'claiming_payment',
        },
      },
    });
    const { supabase } = createAuditSupabase([
      { count: 1, data: [row], error: null },
      { count: 0, data: [], error: null },
      { count: 0, data: [], error: null },
    ]);

    await runAuditAgenticDvaConsentCutoverCli([], supabase as never, now);

    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(output).not.toContain('+2348012345678');
    expect(output).not.toContain('buyer@example.com');
    expect(output).not.toContain('merchant-1');
    expect(output).not.toContain('secret-canary');
  });

  it('counts a non-mutable transitional row and requires manual review', async () => {
    const row = claimingRow();
    row.status = 'completed';
    const { supabase } = createAuditSupabase([
      { count: 1, data: [row], error: null },
      { count: 0, data: [], error: null },
      { count: 0, data: [], error: null },
    ]);

    await expect(
      runAuditAgenticDvaConsentCutoverCli([], supabase as never, now)
    ).resolves.toBe(1);
    const report = JSON.parse(
      vi.mocked(console.log).mock.calls[0][0] as string
    );
    expect(report.states.claiming_payment.entries[0]).toMatchObject({
      disposition: 'manual_review',
      reason: 'session_status_not_mutable',
    });
  });

  it('returns zero only when every transitional count is zero', async () => {
    const { supabase } = createAuditSupabase([
      { count: 0, data: [], error: null },
      { count: 0, data: [], error: null },
      { count: 0, data: [], error: null },
    ]);

    await expect(
      runAuditAgenticDvaConsentCutoverCli([], supabase as never, now)
    ).resolves.toBe(0);
  });

  it('fails closed on a query error without printing returned data', async () => {
    const { supabase } = createAuditSupabase([
      {
        count: null,
        data: [claimingRow()],
        error: { message: 'database canary 1234567890' },
      },
    ]);

    await expect(
      runAuditAgenticDvaConsentCutoverCli([], supabase as never, now)
    ).resolves.toBe(1);
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      'Agentic DVA cutover audit failed while reading transitional state.'
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AGENTIC_DVA_CUTOVER_AUDIT_READ_FAILED',
        errorType: 'object',
      })
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      'database canary 1234567890'
    );
  });

  it.each([
    [['--limit'], '--limit requires an integer from 1 to 500'],
    [['--limit', '0'], '--limit requires an integer from 1 to 500'],
    [['--limit', '501'], '--limit requires an integer from 1 to 500'],
    [['--unknown'], 'Unknown argument'],
  ])('rejects invalid arguments %#', async (argv, message) => {
    const { supabase } = createAuditSupabase([]);
    await expect(
      runAuditAgenticDvaConsentCutoverCli(argv, supabase as never, now)
    ).rejects.toThrow(message);
  });
});

function createAuditSupabase(
  results: Array<{ count: number | null; data: unknown[]; error: unknown }>
) {
  const chains = results.map((result) => {
    const chain = {
      eq: vi.fn(),
      in: vi.fn(),
      limit: vi.fn(),
      or: vi.fn(),
      order: vi.fn(),
      select: vi.fn(),
    };
    chain.eq.mockReturnValue(chain);
    chain.in.mockReturnValue(chain);
    chain.or.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit.mockResolvedValue(result);
    chain.select.mockReturnValue(chain);
    return chain;
  });
  let index = 0;
  return {
    chains,
    supabase: {
      from: vi.fn(() => chains[index++]),
    },
  };
}
