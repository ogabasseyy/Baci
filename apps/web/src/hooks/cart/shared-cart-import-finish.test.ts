import { expect, it, vi } from 'vitest';
import { saveSharedCartImportReceipt } from './cart-storage';
import { createImportFinisher } from './shared-cart-import-finish';
import { cartLine, snapshot } from './shared-cart-provisioning.test-support';

vi.mock('./cart-storage', () => ({
  saveSharedCartImportReceipt: vi.fn(),
}));
vi.mock('./shared-cart-storage', () => ({
  consumedReceiptFields: vi.fn(() => ({})),
}));

function context(confirmed: unknown) {
  return {
    dispatch: vi.fn(),
    generationRef: { current: 7 },
    importOpIdsRef: { current: new Set(['op-1']) },
    importSourceIdsRef: { current: [] },
    optionsRef: { current: { merchantSlug: 'shop' } },
    stateRef: { current: { confirmed } },
  };
}

it('finishes with the reconciled snapshot before stateRef commits it', () => {
  const stale = snapshot({ lines: [] });
  const reconciled = snapshot({ lines: [cartLine()] });
  const ctx = context(stale);
  const finish = createImportFinisher(ctx as never);
  finish('op-1', { ok: true, snapshot: reconciled as never });
  expect(ctx.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      lineCount: 1,
      snapshot: reconciled,
      type: 'import/finished',
    })
  );
  expect(saveSharedCartImportReceipt).toHaveBeenCalledWith(
    'shop',
    expect.objectContaining({ lineCount: 1 })
  );
});

it('dispatches import/failed and clears pending ops on failure', () => {
  const ctx = context(snapshot());
  const finish = createImportFinisher(ctx as never);
  finish('op-1', { ok: false, code: 'not_found' });
  expect(ctx.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ code: 'not_found', type: 'import/failed' })
  );
  expect(ctx.importOpIdsRef.current.size).toBe(0);
});

it('ignores unknown operation ids', () => {
  const ctx = context(snapshot());
  const finish = createImportFinisher(ctx as never);
  finish('other-op', { ok: true });
  expect(ctx.dispatch).not.toHaveBeenCalled();
});
