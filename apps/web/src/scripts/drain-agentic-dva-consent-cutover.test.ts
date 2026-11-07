import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeAgenticCheckoutPayment } from '@/lib/agentic/checkout-completion-finalize';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import { logger } from '@/lib/logger';
import { runDrainAgenticDvaConsentCutoverCli } from './drain-agentic-dva-consent-cutover';
import { drainAgenticDvaTestSupport } from './drain-agentic-dva-consent-cutover.test-support';

vi.mock('@/lib/agentic/checkout-completion-finalize', () => ({
  finalizeAgenticCheckoutPayment: vi.fn(),
}));
vi.mock('@/lib/agentic/idempotency', () => ({
  reserveAgenticIdempotencyKey: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

const { accountReadyRow, argsFor, claimingRow, createSupabase, now } =
  drainAgenticDvaTestSupport;

describe('runDrainAgenticDvaConsentCutoverCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      state: 'reserved',
    });
    vi.mocked(finalizeAgenticCheckoutPayment).mockResolvedValue(
      new Response(null, { status: 200 }) as never
    );
  });

  it('refuses to drain while new Agentic Paystack DVA setup is enabled', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'enabled');
    const row = claimingRow();
    const { supabase } = createSupabase(row);

    await expect(
      runDrainAgenticDvaConsentCutoverCli(
        argsFor(row, 'claiming_payment'),
        supabase as never,
        now
      )
    ).resolves.toBe(1);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      'Agentic Paystack DVA must be paused before the cutover drain.'
    );
  });

  it('distinguishes invalid DVA mode configuration from enabled mode', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'invalid');
    const { supabase } = createSupabase(claimingRow());

    await expect(
      runDrainAgenticDvaConsentCutoverCli([], supabase as never, now)
    ).resolves.toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AGENTIC_DVA_CUTOVER_MODE_RESOLUTION_FAILED',
      })
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('fails closed on a session read error without logging provider details', async () => {
    const row = claimingRow();
    const { supabase } = createSupabase(
      row,
      { data: null, error: null },
      {
        data: null,
        error: { code: 'PGRST000', message: 'secret provider detail' },
      }
    );

    await expect(
      runDrainAgenticDvaConsentCutoverCli(
        argsFor(row, 'claiming_payment'),
        supabase as never,
        now
      )
    ).resolves.toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AGENTIC_DVA_CUTOVER_SESSION_READ_FAILED',
        databaseCode: 'PGRST000',
        errorType: 'object',
      })
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      'secret provider detail'
    );
  });

  it('does not authorize a dry-run release for an unconfirmed stale claim', async () => {
    const row = claimingRow();
    const { supabase, update } = createSupabase(row);
    await expect(runDrainAgenticDvaConsentCutoverCli(argsFor(row, 'claiming_payment'), supabase as never, now)).resolves.toBe(1);
    expect(update).not.toHaveBeenCalled();
    expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
  });

  it('rejects a state or evidence mismatch without any mutation', async () => {
    const row = claimingRow();
    const { supabase, update } = createSupabase(row);
    const argv = argsFor(row, 'claiming_payment');
    argv[argv.indexOf('--evidence-fingerprint') + 1] = '0'.repeat(64);

    await expect(
      runDrainAgenticDvaConsentCutoverCli(argv, supabase as never, now)
    ).resolves.toBe(1);
    expect(update).not.toHaveBeenCalled();
    expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
  });

  it('does not release an unconfirmed stale claim on apply', async () => {
    const row = claimingRow();
    const { supabase, update } = createSupabase(row, { data: { session_id: row.session_id }, error: null });
    await expect(runDrainAgenticDvaConsentCutoverCli([...argsFor(row, 'claiming_payment'), '--apply'], supabase as never, now)).resolves.toBe(1);
    expect(update).not.toHaveBeenCalled();
    expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
  });

  it('resumes a stored account through the finalizer after reserving idempotency', async () => {
    const row = accountReadyRow();
    const { supabase, update } = createSupabase(row);

    await expect(
      runDrainAgenticDvaConsentCutoverCli(
        [...argsFor(row, 'payment_account_ready'), '--apply'],
        supabase as never,
        now
      )
    ).resolves.toBe(0);

    expect(update).not.toHaveBeenCalled();
    expect(reserveAgenticIdempotencyKey).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        route: 'checkout_sessions.complete',
      })
    );
    expect(finalizeAgenticCheckoutPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSessionUpdatedAt: row.updated_at,
        finalizationClaimOverride: undefined,
        sessionId: row.session_id,
      })
    );
  });

  it('fails closed on a currency mismatch without reserving or finalizing', async () => {
    const row = accountReadyRow();
    row.currency = 'USD';
    const { supabase } = createSupabase(row);

    await expect(
      runDrainAgenticDvaConsentCutoverCli(
        [...argsFor(row, 'payment_account_ready'), '--apply'],
        supabase as never,
        now
      )
    ).resolves.toBe(1);

    expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
    expect(finalizeAgenticCheckoutPayment).not.toHaveBeenCalled();
  });

  it('does not finalize when the idempotency reservation is not acquired', async () => {
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      requestHash: 'hash',
      response: { status: 'payment_pending' },
      state: 'replay',
      status: 200,
    });
    const row = accountReadyRow();
    const { supabase } = createSupabase(row);

    await expect(
      runDrainAgenticDvaConsentCutoverCli(
        [...argsFor(row, 'payment_account_ready'), '--apply'],
        supabase as never,
        now
      )
    ).resolves.toBe(1);
    expect(finalizeAgenticCheckoutPayment).not.toHaveBeenCalled();
  });

  it.each([
    [[], 'Missing required argument: --session-id'],
    [['--session-id', 'bad id'], '--session-id is invalid'],
    [['--session-id', '1234567890'], '--session-id is invalid'],
    [
      [
        '--session-id', 'agentic_session_1', '--expected-state',
        'claiming_payment', '--evidence-fingerprint', 'ABC',
      ],
      '--evidence-fingerprint must be a lowercase SHA-256 digest',
    ],
  ])('rejects invalid operator arguments %#', async (argv, message) => {
    const { supabase } = createSupabase(claimingRow());
    await expect(
      runDrainAgenticDvaConsentCutoverCli(argv, supabase as never, now)
    ).rejects.toThrow(message);
  });
});
