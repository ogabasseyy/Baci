import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { primaryWalletSavingsReconciliationCheckpointSchemas as checkpointSchemas } from '@/schemas/primary-wallet-savings-reconciliation-checkpoint';
import { resolvePrimaryWalletSavingsIdentity } from './primary-wallet-savings-identity';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';
import { requestInput } from './primary-wallet-savings-identity.test-utils';

function checkpoint(
  initial: z.infer<
    typeof checkpointSchemas.state
  > = checkpointSchemas.emptyState
) {
  let state = checkpointSchemas.state.parse(initial);
  const save = vi.fn(async (next: typeof state) => {
    state = checkpointSchemas.state.parse(next);
    return true;
  });
  return {
    get state() {
      return state;
    },
    save,
  };
}

describe('production savings continuation checkpoint', () => {
  it('resumes an interrupted full scan and still requires exact list proof', async () => {
    const stored = checkpoint();
    const first = requestInput(
      [
        {
          edges: [{ id: 'older-transfer' }],
          pageInfo: { hasNextPage: true, endCursor: 'full-cursor-1' },
        },
      ],
      fixture.wallet,
      'production',
      fixture.singleTransaction
    );
    const firstFetch = first.fetchImplementation.getMockImplementation();
    let pages = 0;
    first.fetchImplementation.mockImplementation((url, init) => {
      if (new URL(String(url)).pathname === '/api/v1/transaction') {
        pages += 1;
        return pages === 1
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  status: true,
                  data: {
                    edges: [{ id: 'older-transfer' }],
                    pageInfo: { hasNextPage: true, endCursor: 'full-cursor-1' },
                  },
                })
              )
            )
          : Promise.reject(new Error('provider timeout'));
      }
      return firstFetch?.(url, init) ?? Promise.resolve(new Response());
    });
    first.checkpoint = stored;
    expect(await resolvePrimaryWalletSavingsIdentity(first)).toBeNull();
    expect(stored.state).toMatchObject({
      stage: 'full',
      cursor: 'full-cursor-1',
    });

    const second = requestInput(
      [fixture.page],
      fixture.wallet,
      'production',
      fixture.singleTransaction
    );
    second.checkpoint = { ...stored, state: stored.state };
    expect(await resolvePrimaryWalletSavingsIdentity(second)).toEqual({
      environment: 'production',
      wallet: fixture.wallet,
      transaction: fixture.transaction,
    });
    const listUrl = new URL(
      String(second.fetchImplementation.mock.calls[2][0])
    );
    expect(listUrl.searchParams.get('cursor')).toBe('full-cursor-1');
    expect(listUrl.searchParams.has('start_date')).toBe(false);
    expect(stored.state).toEqual(checkpointSchemas.emptyState);
  });

  it('clears stale scope state and starts the list without its cursor', async () => {
    const stored = checkpoint({
      stage: 'full',
      fingerprint: 'f'.repeat(64),
      cursor: 'foreign-cursor',
      pageDigest: 'a'.repeat(64),
    });
    const input = requestInput(
      [fixture.page],
      fixture.wallet,
      'production',
      fixture.singleTransaction
    );
    input.checkpoint = stored;
    expect(await resolvePrimaryWalletSavingsIdentity(input)).toMatchObject({
      environment: 'production',
      transaction: fixture.transaction,
    });
    const listUrl = new URL(String(input.fetchImplementation.mock.calls[2][0]));
    expect(listUrl.searchParams.has('cursor')).toBe(false);
    expect(stored.save).toHaveBeenCalledWith(checkpointSchemas.emptyState);
  });

  it('retains the last validated cursor on a transient next-page failure', async () => {
    const stored = checkpoint();
    const input = requestInput(
      [
        {
          edges: [{ id: 'older-transfer' }],
          pageInfo: { hasNextPage: true, endCursor: 'resume-here' },
        },
      ],
      fixture.wallet,
      'production',
      fixture.singleTransaction
    );
    const defaultFetch = input.fetchImplementation.getMockImplementation();
    let pageRequests = 0;
    input.fetchImplementation.mockImplementation((url, init) => {
      if (new URL(String(url)).pathname === '/api/v1/transaction') {
        pageRequests += 1;
        return pageRequests === 1
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  status: true,
                  data: {
                    edges: [{ id: 'older-transfer' }],
                    pageInfo: { hasNextPage: true, endCursor: 'resume-here' },
                  },
                })
              )
            )
          : Promise.reject(new Error('temporary provider outage'));
      }
      return defaultFetch?.(url, init) ?? Promise.resolve(new Response());
    });
    input.checkpoint = stored;
    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(stored.state).toMatchObject({
      stage: 'full',
      cursor: 'resume-here',
    });
  });

  it('fails closed when checkpoint fencing rejects a page advancement', async () => {
    const stored = checkpoint();
    stored.save.mockImplementation(async (next) => next.cursor === null);
    const input = requestInput(
      [
        {
          edges: [{ id: 'older-transfer' }],
          pageInfo: { hasNextPage: true, endCursor: 'next' },
        },
      ],
      fixture.wallet,
      'production',
      fixture.singleTransaction
    );
    input.checkpoint = stored;
    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it('resets malformed pages, terminal no-match, and refuses checkpoint scans without direct proof', async () => {
    const malformed = checkpoint();
    const malformedInput = requestInput(
      [{ edges: 'invalid' }],
      fixture.wallet,
      'production',
      fixture.singleTransaction
    );
    malformedInput.checkpoint = malformed;
    expect(
      await resolvePrimaryWalletSavingsIdentity(malformedInput)
    ).toBeNull();
    expect(malformed.save).toHaveBeenCalledWith(checkpointSchemas.emptyState);

    const noMatch = checkpoint();
    const terminalInput = requestInput(
      [
        {
          edges: [{ id: 'different-transfer' }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      ],
      fixture.wallet,
      'production',
      fixture.singleTransaction
    );
    terminalInput.checkpoint = noMatch;
    expect(await resolvePrimaryWalletSavingsIdentity(terminalInput)).toBeNull();
    expect(noMatch.save).toHaveBeenCalledWith(checkpointSchemas.emptyState);

    const noDirect = checkpoint();
    const directUnavailable = requestInput(
      [fixture.page],
      fixture.wallet,
      'production',
      null
    );
    directUnavailable.checkpoint = noDirect;
    expect(
      await resolvePrimaryWalletSavingsIdentity(directUnavailable)
    ).toBeNull();
    expect(directUnavailable.fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
