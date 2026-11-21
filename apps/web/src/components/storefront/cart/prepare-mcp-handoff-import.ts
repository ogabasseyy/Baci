import type { CartSnapshot } from '@baci/shared/cart';
import {
  loadAttemptBody,
  loadOrCreateAttemptId,
  lockedAttemptChoice,
  type PreviewResponse,
} from './cart-handoff-support';

export function prepareMcpHandoffImport(
  preview: PreviewResponse,
  destCart: CartSnapshot | null,
  handoffId: string,
  token: string
): Record<string, unknown> | null {
  if (!preview.importMcp || !preview.snapshot) return null;
  const previousChoice = lockedAttemptChoice(handoffId);
  if (previousChoice && previousChoice !== 'import_mcp') return null;
  return (
    loadAttemptBody(handoffId) ?? {
      attemptId: loadOrCreateAttemptId(handoffId),
      choice: 'import_mcp',
      destCartId: destCart?.cartId,
      expectedIncomingVersion: preview.snapshot.version,
      handoffId,
      token,
    }
  );
}
