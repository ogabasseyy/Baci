import { describe, expect, it, vi } from 'vitest';
import { resolveManualDocumentClaimDomain } from './resolve-manual-document-claim-domain';

function clientReturning(result: unknown) {
  const terminal = { maybeSingle: vi.fn().mockResolvedValue(result) };
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue(terminal),
  };
  const from = vi.fn().mockReturnValue(chain);
  return { client: { from }, from };
}

describe('resolveManualDocumentClaimDomain', () => {
  it('returns the active primary domain', async () => {
    const { client, from } = clientReturning({
      data: { domain: 'shop.example.com' },
      error: null,
    });

    await expect(
      resolveManualDocumentClaimDomain(client as never, 'merchant-1')
    ).resolves.toBe('shop.example.com');
    expect(from).toHaveBeenCalledWith('domains');
  });

  it('returns null when no primary domain is assigned', async () => {
    const { client } = clientReturning({ data: null, error: null });

    await expect(
      resolveManualDocumentClaimDomain(client as never, 'merchant-1')
    ).resolves.toBeNull();
  });

  it('returns null when the lookup fails', async () => {
    const { client } = clientReturning({
      data: { domain: 'shop.example.com' },
      error: { message: 'boom' },
    });

    await expect(
      resolveManualDocumentClaimDomain(client as never, 'merchant-1')
    ).resolves.toBeNull();
  });
});
