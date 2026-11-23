import { afterEach, describe, expect, it, vi } from 'vitest';
import { postChatwootBridgeJson } from './chatwoot-bridge-request';
import { createEkaetteBankLookup } from './ekaette-bank-lookup';

vi.mock('./chatwoot-bridge-request', () => ({
  postChatwootBridgeJson: vi.fn(),
}));

const REQ_1 = '60000000-0000-4000-8000-000000000001';
const REQ_2 = '60000000-0000-4000-8000-000000000002';
const REQ_3 = '60000000-0000-4000-8000-000000000003';

const command = (payload: Record<string, unknown>) =>
  `baci-ekaette-bank:${JSON.stringify({
    requestId: REQ_1,
    conversationId: 42,
    sessionToken: 'session-tok',
    ...payload,
  })}`;

describe('createEkaetteBankLookup', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns banks on a valid banks command and ignores malformed commands', async () => {
    const lookup = createEkaetteBankLookup('savings-synthetic');
    const post = vi.fn();

    await lookup.receive('not-a-bank-command', post);
    await lookup.receive('baci-ekaette-bank:{bad-json', post);
    await lookup.receive(command({ action: 'unknown' }), post);
    expect(post).not.toHaveBeenCalled();

    vi.mocked(postChatwootBridgeJson).mockResolvedValueOnce({
      banks: [{ code: '058', name: 'GTBank' }],
    });
    await lookup.receive(command({ action: 'banks' }), post);
    expect(post).toHaveBeenCalledWith({
      requestId: REQ_1,
      status: 'banks',
      banks: [{ code: '058', name: 'GTBank' }],
    });
  });

  it('forwards resolve requests and posts only masked account details back', async () => {
    const lookup = createEkaetteBankLookup('savings-synthetic');
    const post = vi.fn();
    vi.mocked(postChatwootBridgeJson).mockResolvedValueOnce({
      accountName: 'ADA OBI',
      maskedAccountNumber: '••••••6789',
      verificationReference: 'a'.repeat(64),
    });

    await lookup.receive(
      command({
        action: 'resolve',
        bankCode: '058',
        accountNumber: '0123456789',
        phone: '+2348012345678',
      }),
      post
    );

    expect(post).toHaveBeenCalledWith({
      requestId: REQ_1,
      status: 'resolved',
      accountName: 'ADA OBI',
      maskedAccountNumber: '••••••6789',
      verificationReference: 'a'.repeat(64),
    });
  });

  it('reports unavailable on malformed responses or provider errors', async () => {
    const lookup = createEkaetteBankLookup('savings-synthetic');
    const post = vi.fn();

    vi.mocked(postChatwootBridgeJson)
      .mockResolvedValueOnce({ banks: 'bad' })
      .mockRejectedValueOnce(new Error('network down'));

    await lookup.receive(command({ action: 'banks' }), post);
    expect(post).toHaveBeenLastCalledWith({
      requestId: REQ_1,
      status: 'banks_unavailable',
    });

    await lookup.receive(
      command({
        action: 'resolve',
        bankCode: '058',
        accountNumber: '0123456789',
        phone: '+2348012345678',
      }),
      post
    );
    expect(post).toHaveBeenLastCalledWith({
      requestId: REQ_1,
      status: 'resolve_unavailable',
    });
  });

  it('drops callbacks when closed or superseded by a newer request', async () => {
    const lookup = createEkaetteBankLookup('savings-synthetic');
    const post = vi.fn();

    let resolveFirst: ((v: Record<string, unknown> | null) => void) | undefined;
    vi.mocked(postChatwootBridgeJson)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ banks: [{ code: '044', name: 'Access' }] });

    const first = lookup.receive(
      command({ requestId: REQ_1, action: 'banks' }),
      post
    );
    const second = lookup.receive(
      command({ requestId: REQ_2, action: 'banks' }),
      post
    );
    await second;
    resolveFirst?.({ banks: [{ code: '058', name: 'GTBank' }] });
    await first;

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      requestId: REQ_2,
      status: 'banks',
      banks: [{ code: '044', name: 'Access' }],
    });

    post.mockClear();
    let resolveClosed: ((v: Record<string, unknown> | null) => void) | undefined;
    vi.mocked(postChatwootBridgeJson).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveClosed = resolve;
        })
    );
    const closedReq = lookup.receive(
      command({ requestId: REQ_3, action: 'banks' }),
      post
    );
    lookup.close();
    resolveClosed?.({ banks: [] });
    await closedReq;
    expect(post).not.toHaveBeenCalled();
  });
});
