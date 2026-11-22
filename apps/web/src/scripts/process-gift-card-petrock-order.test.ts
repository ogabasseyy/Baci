import { expect, it, vi } from 'vitest';

const { postgres, createPetrockClient } = vi.hoisted(() => ({
  postgres: vi.fn(),
  createPetrockClient: vi.fn(),
}));
vi.mock('postgres', () => ({ default: postgres }));
vi.mock('../lib/imei-providers/petrock/petrock-client', () => ({ createPetrockClient }));

it('rejects invalid command configuration before connecting and emits only redacted diagnostics', async () => {
  const previous = process.exitCode;
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('GIFT_CARD_WORKER_DATABASE_URL', 'private-fixture-url');
  try {
    await import('./process-gift-card-petrock-order');
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(log.mock.calls[0]?.[0]).toContain('invalid_configuration');
    expect(log.mock.calls[0]?.[0]).not.toContain('private-fixture-url');
    expect(postgres).not.toHaveBeenCalled();
    expect(createPetrockClient).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = previous;
    log.mockRestore();
    vi.unstubAllEnvs();
  }
});
