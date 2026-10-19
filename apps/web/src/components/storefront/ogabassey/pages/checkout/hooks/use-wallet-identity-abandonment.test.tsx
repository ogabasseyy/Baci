import { waitFor } from '@testing-library/react';
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWallet } from './use-wallet';

describe('useWallet identity abandonment', () => {
  const mockFetch = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not poison the committed generation when a new-identity render suspends before committing', async () => {
    // Codex R133 P2: an abandoned concurrent render must not claim
    // a fetch generation or raise the initial-read gate — ref
    // mutations cannot roll back, so the committed identity's
    // in-flight fetch would supersede itself and wedge checkout
    // until refresh/remount. Fails pre-fix: the render-phase claim
    // runs during user-b's discarded render, flipping the shared
    // refs the committed user-a instance reads.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ balance: 1000 }),
    });
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const captured: Record<string, ReturnType<typeof useWallet>> = {};
    let suspendOnUserId: string | null = null;
    let suspenderThrows = 0;
    function Suspender({ userId }: { userId: string }) {
      if (suspendOnUserId !== null && userId === suspendOnUserId) {
        suspenderThrows += 1;
        throw new Promise(() => {});
      }
      return null;
    }
    function Harness({ userId }: { userId: string }) {
      const wallet = useWallet({ userId, merchantSlug: 'test-merchant' });
      captured[userId] = wallet;
      return <Suspender userId={userId} />;
    }

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <Suspense fallback={null}>
            <Harness userId="user-a" />
          </Suspense>
        );
      });
      await waitFor(() => expect(captured['user-a'].walletBalance).toBe(1000));
      expect(captured['user-a'].isWalletInitialReadPending()).toBe(false);

      suspendOnUserId = 'user-b';
      await act(async () => {
        root.render(
          <Suspense fallback={null}>
            <Harness userId="user-b" />
          </Suspense>
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // user-b's render ran (and suspended) but never committed.
      expect(suspenderThrows).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // The committed user-a generation is untouched: no gate wedge,
      // no balance loss.
      expect(captured['user-a'].isWalletInitialReadPending()).toBe(false);
      expect(captured['user-a'].getWalletBalance()).toBe(1000);
    } finally {
      suspendOnUserId = null;
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
