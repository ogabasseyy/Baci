import { describe, expect, it, vi } from 'vitest';

import {
  runPetrockReconciliationCli,
  validatePetrockReconciliationOrigin,
} from './process-petrock-reconciliation';

describe('process-petrock-reconciliation', () => {
  it('requires a credential-free HTTPS BACI_WEB_BASE_URL', () => {
    expect(() =>
      validatePetrockReconciliationOrigin('http://usebaci.com')
    ).toThrow(/https/);
    expect(() =>
      validatePetrockReconciliationOrigin('https://user:pass@usebaci.com')
    ).toThrow(/credentials/);
  });

  it('runs the shared service directly without CRON_SECRET', async () => {
    const runJob = vi.fn().mockResolvedValue({
      body: {
        claimed: 2,
        completed: 1,
        notifications: {
          customerEmail: 'customer@example.com',
          processed: 1,
        },
        remediation: { providerPayload: 'raw-provider-data' },
      },
      status: 200,
    });
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runPetrockReconciliationCli({
        env: {
          BACI_WEB_BASE_URL: 'https://usebaci.com',
          CRON_SECRET: 'must-not-be-used',
          IMEI_IDENTIFIER_ENCRYPTION_KEY: 'encryption-key',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
          NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
          PETROCK_API_TOKEN: 'petrock-token',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
          ZEPTOMAIL_TOKEN: 'zeptomail-token',
        },
        logger,
        runJob,
      })
    ).resolves.toBe(0);

    expect(runJob).toHaveBeenCalledWith({ origin: 'https://usebaci.com' });
    expect(logger.info).toHaveBeenCalledWith(
      '[petrock-reconciliation] completed',
      JSON.stringify({ claimed: 2, completed: 1, status: 200 })
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('customer@example.com')
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('raw-provider-data')
    );
  });

  it('signals manual review without logging order details', async () => {
    const runJob = vi.fn().mockResolvedValue({ body: { claimed: 0, remediation: { manualReview: 1, orderId: 'secret-order-id' } }, status: 503 });
    const logger = { error: vi.fn(), info: vi.fn() };
    const env = { BACI_WEB_BASE_URL: 'https://usebaci.com', IMEI_IDENTIFIER_ENCRYPTION_KEY: 'key', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'key', NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', PETROCK_API_TOKEN: 'token', SUPABASE_SERVICE_ROLE_KEY: 'key', ZEPTOMAIL_TOKEN: 'token' };
    await expect(runPetrockReconciliationCli({ env, logger, runJob })).resolves.toBe(1);
    expect(logger.info).toHaveBeenCalledWith('[petrock-reconciliation] completed', expect.stringContaining('provider_submission_unresolved'));
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret-order-id');
  });

  it('fails closed before work when a direct-worker variable is missing', async () => {
    const runJob = vi.fn();
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runPetrockReconciliationCli({
        env: {
          BACI_WEB_BASE_URL: 'https://usebaci.com',
          IMEI_IDENTIFIER_ENCRYPTION_KEY: 'encryption-key',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
          NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        },
        logger,
        runJob,
      })
    ).resolves.toBe(1);

    expect(runJob).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[petrock-reconciliation] preflight failed'
    );
  });

  it('fails closed when the Petrock notification token is missing', async () => {
    const runJob = vi.fn();
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runPetrockReconciliationCli({
        env: {
          BACI_WEB_BASE_URL: 'https://usebaci.com',
          IMEI_IDENTIFIER_ENCRYPTION_KEY: 'encryption-key',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
          NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
          PETROCK_API_TOKEN: 'petrock-token',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        },
        logger,
        runJob,
      })
    ).resolves.toBe(1);

    expect(runJob).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[petrock-reconciliation] preflight failed'
    );
  });

  it('sanitizes errors emitted by nested remediation helpers', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const runJob = vi.fn().mockImplementation(async () => {
      console.error('raw-provider-error', {
        orderId: 'customer-linked-order-id',
      });
      return {
        body: { claimed: 1, completed: 0, errored: 1 },
        status: 500,
      };
    });
    const logger = { error: vi.fn(), info: vi.fn() };

    await runPetrockReconciliationCli({
      env: {
        BACI_WEB_BASE_URL: 'https://usebaci.com',
        IMEI_IDENTIFIER_ENCRYPTION_KEY: 'encryption-key',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        PETROCK_API_TOKEN: 'petrock-token',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        ZEPTOMAIL_TOKEN: 'zeptomail-token',
      },
      logger,
      runJob,
    });

    expect(logger.error).toHaveBeenCalledWith(
      '[petrock-reconciliation] internal error'
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('raw-provider-error'),
      expect.anything()
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'customer-linked-order-id'
    );
    consoleError.mockRestore();
  });
});
