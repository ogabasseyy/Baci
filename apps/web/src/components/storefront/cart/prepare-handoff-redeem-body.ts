import type { CartSnapshot } from '@baci/shared/cart';
import {
  type Choice,
  loadAttemptBody,
  loadOrCreateAttemptId,
  lockedAttemptChoice,
  type PreviewResponse,
} from './cart-handoff-support';

export function prepareHandoffRedeemBody(
  preview: PreviewResponse,
  destCart: CartSnapshot | null,
  handoffId: string,
  token: string,
  choice: Choice
): Record<string, unknown> | null {
  if (!preview.snapshot) return null;
  if (choice === 'import_mcp') {
    if (!preview.importMcp) return null;
    const previousChoice = lockedAttemptChoice(handoffId);
    if (previousChoice && previousChoice !== choice) return null;
  }
  return (
    loadAttemptBody(handoffId) ?? {
      attemptId: loadOrCreateAttemptId(handoffId),
      choice,
      destCartId: destCart?.cartId,
      ...(choice === 'import_mcp'
        ? {}
        : { expectedDestVersion: destCart?.version }),
      expectedIncomingVersion: preview.snapshot.version,
      handoffId,
      token,
    }
  );
}
