import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleJumiaMobileTicket } from './mobile-ticket';

const { mockCreateAnonClient, mockGetJumiaAuthUrl, mockRpc } = vi.hoisted(
  () => ({
    mockCreateAnonClient: vi.fn(),
    mockGetJumiaAuthUrl: vi.fn(),
    mockRpc: vi.fn(),
  })
);
vi.mock('@/env', () => ({
  getConfiguredAppUrl: vi.fn(() => 'https://usebaci.com'),
  getJumiaClientId: vi.fn(() => 'client-id'),
}));
vi.mock('@/lib/jumia/helpers', () => ({
  getJumiaAuthUrl: (...args: unknown[]) => mockGetJumiaAuthUrl(...args),
  getJumiaRedirectUri: vi.fn(
    () => 'https://usebaci.com/api/marketplace/jumia/callback'
  ),
}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: (...args: unknown[]) => mockCreateAnonClient(...args),
}));

const TICKET_ID = '00000000-0000-4000-8000-000000000099';
const query = `connectionType=oauth&platform=mobile&ticket=${TICKET_ID}`;
function makeRequest(value: string): NextRequest {
  return new NextRequest(
    `https://usebaci.com/api/marketplace/jumia/connect?${value}`
  );
}

describe('handleJumiaMobileTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockCreateAnonClient.mockReturnValue({ rpc: mockRpc });
    mockGetJumiaAuthUrl.mockReturnValue(
      'https://vendor-api.jumia.com/login?state=state'
    );
    mockRpc.mockResolvedValue({ data: true, error: null });
  });
  it('returns null for ordinary OAuth requests', async () => {
    await expect(
      handleJumiaMobileTicket(
        makeRequest('connectionType=oauth'),
        new URLSearchParams('connectionType=oauth')
      )
    ).resolves.toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('rejects malformed tickets without touching the database', async () => {
    const response = await handleJumiaMobileTicket(
      makeRequest('connectionType=oauth&platform=mobile&ticket=bad'),
      new URLSearchParams('connectionType=oauth&platform=mobile&ticket=bad')
    );
    expect(response?.status).toBe(307);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('redeems a valid ticket and sets only handoff cookies', async () => {
    const now = Date.parse('2026-08-21T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const response = await handleJumiaMobileTicket(
      makeRequest(query),
      new URLSearchParams(query)
    );
    expect(mockCreateAnonClient).toHaveBeenCalledTimes(1);
    expect(response?.status).toBe(307);
    expect(mockRpc).toHaveBeenCalledWith(
      'redeem_jumia_oauth_handoff_ticket',
      expect.objectContaining({
        p_ticket_id: TICKET_ID,
        p_oauth_state: expect.any(String),
        p_redeemed_expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
      })
    );
    expect(response?.headers.get('set-cookie')).toContain(
      'jumia_oauth_platform=mobile'
    );
    expect(response?.headers.get('set-cookie')).not.toContain(
      'jumia_merchant_id='
    );
  });
  it('fails closed when redemption rejects the ticket', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const response = await handleJumiaMobileTicket(
      makeRequest(query),
      new URLSearchParams(query)
    );
    expect(response?.status).toBe(307);
    expect(response?.headers.get('location')).toContain('ticket_invalid');
    expect(mockGetJumiaAuthUrl).not.toHaveBeenCalled();
  });
});
