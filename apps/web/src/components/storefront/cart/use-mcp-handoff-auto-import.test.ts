import type { CartSnapshot } from '@baci/shared/cart';
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useMcpHandoffAutoImport } from './use-mcp-handoff-auto-import';

it('starts one automatic import for the signed preview, including its merchant scope', async () => {
  const lockChoice = vi.fn();
  const postRedeem = vi.fn(async () => true);
  const { result } = renderHook(() =>
    useMcpHandoffAutoImport('cart-transfer', 'ch1.fixture.signature', {
      lockChoice,
      postRedeem,
    })
  );
  const preview = {
    status: 'pending' as const,
    expiresAt: null,
    snapshot: { version: 4 } as CartSnapshot,
    merchant: { id: 'merchant', slug: 'ogabassey' },
  };
  await result.current(preview, { cart: null });
  expect(postRedeem).not.toHaveBeenCalled();
  await result.current({ ...preview, importMcp: true }, { cart: null });
  await result.current({ ...preview, importMcp: true }, { cart: null });
  expect(lockChoice).toHaveBeenCalledExactlyOnceWith('import_mcp');
  expect(postRedeem).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      choice: 'import_mcp',
      expectedIncomingVersion: 4,
    }),
    'ogabassey'
  );
});
