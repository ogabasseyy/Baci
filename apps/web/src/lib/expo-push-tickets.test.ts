import { describe, expect, it, vi } from 'vitest';
import { processTicketsWithStore } from './expo-push-tickets';
import type { PushStore } from './push-store';

function store() {
  return {
    deactivateTokens: vi.fn().mockResolvedValue({ error: null }),
    insertTickets: vi.fn().mockResolvedValue({ error: null }),
  } as unknown as PushStore & {
    deactivateTokens: ReturnType<typeof vi.fn>;
    insertTickets: ReturnType<typeof vi.fn>;
  };
}

describe('processTicketsWithStore', () => {
  it('stores accepted tickets for receipt polling', async () => {
    const s = store();

    const result = await processTicketsWithStore(
      [{ id: 'tk', status: 'ok' }],
      [{ platform: 'ios', token: 'tok' }],
      s,
      { appType: 'admin', merchantId: 'm' }
    );

    expect(result).toMatchObject({ failed: 0, sent: 1 });
    expect(s.insertTickets).toHaveBeenCalledWith([
      expect.objectContaining({
        merchant_id: 'm',
        push_token: 'tok',
        ticket_id: 'tk',
      }),
    ]);
  });

  it('deactivates tokens the provider reports as unregistered', async () => {
    const s = store();

    const result = await processTicketsWithStore(
      [
        {
          details: { error: 'DeviceNotRegistered' },
          message: 'gone',
          status: 'error',
        },
      ],
      [{ platform: 'ios', token: 'dead' }],
      s
    );

    expect(s.deactivateTokens).toHaveBeenCalledWith('DeviceNotRegistered', [
      'dead',
    ]);
    expect(result.failed).toBe(1);
  });
});
