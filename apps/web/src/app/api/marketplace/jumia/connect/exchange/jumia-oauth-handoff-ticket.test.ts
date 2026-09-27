import { describe, expect, it, vi } from 'vitest';
import {
  claimJumiaOAuthHandoffTicket,
  finalizeJumiaOAuthHandoffTicket,
  releaseJumiaOAuthHandoffTicket,
} from './jumia-oauth-handoff-ticket';

describe('jumia oauth handoff ticket helpers', () => {
  it('claims a redeemed ticket via the exchange RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(
      claimJumiaOAuthHandoffTicket({ rpc } as never, {
        merchantId: 'merchant-1',
        ticketId: 'ticket-1',
      })
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('exchange_jumia_oauth_handoff_ticket', {
      p_merchant_id: 'merchant-1',
      p_ticket_id: 'ticket-1',
    });
  });

  it('throws when the ticket claim RPC fails transiently', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'database unavailable' },
    });

    await expect(
      claimJumiaOAuthHandoffTicket({ rpc } as never, {
        merchantId: 'merchant-1',
        ticketId: 'ticket-1',
      })
    ).rejects.toThrow('Failed to claim Jumia OAuth handoff ticket');
  });

  it('finalizes a claimed ticket after durable OAuth persistence', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(
      finalizeJumiaOAuthHandoffTicket({ rpc } as never, {
        merchantId: 'merchant-1',
        ticketId: 'ticket-1',
      })
    ).resolves.toBe(true);
  });

  it('releases a claimed ticket when OAuth persistence fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await releaseJumiaOAuthHandoffTicket({ rpc } as never, {
      merchantId: 'merchant-1',
      ticketId: 'ticket-1',
    });
    expect(rpc).toHaveBeenCalledWith('release_jumia_oauth_handoff_ticket', {
      p_merchant_id: 'merchant-1',
      p_ticket_id: 'ticket-1',
    });
  });
});
