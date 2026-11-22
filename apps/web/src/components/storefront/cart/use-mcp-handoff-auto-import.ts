import type { CartSnapshot } from '@baci/shared/cart';
import { useRef } from 'react';
import type { Choice, PreviewResponse } from './cart-handoff-support';
import { prepareHandoffRedeemBody } from './prepare-handoff-redeem-body';

export function useMcpHandoffAutoImport(
  handoffId: string,
  token: string,
  {
    lockChoice,
    postRedeem,
  }: {
    lockChoice: (choice: Choice) => void;
    postRedeem: (
      body: Record<string, unknown>,
      slug?: string
    ) => Promise<boolean>;
  }
) {
  const started = useRef(false);
  return async (
    preview: PreviewResponse,
    destination: { cart: CartSnapshot | null } | undefined,
    signal?: AbortSignal
  ) => {
    if (!destination || signal?.aborted || started.current) return;
    const body = prepareHandoffRedeemBody(
      preview,
      destination.cart,
      handoffId,
      token,
      'import_mcp'
    );
    if (!body) return;
    started.current = true;
    lockChoice('import_mcp');
    await postRedeem(body, preview.merchant?.slug ?? undefined);
  };
}
