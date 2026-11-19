/** Who handled a conversation. Exactly one of the two is set at a time. */
export const CHAT_LABEL_AI = 'handled-by-ai';
export const CHAT_LABEL_MERCHANT = 'handled-by-merchant';
/** The assistant passed this conversation to a person. */
export const CHAT_LABEL_NEEDS_HUMAN = 'needs-human';

/** The provider replaces a conversation's whole label list, so merge first. */
export function mergeChatLabels(
  existing: readonly string[],
  change: { add?: readonly string[]; remove?: readonly string[] }
): string[] {
  const removed = new Set(change.remove ?? []);
  const kept = existing.filter((label) => !removed.has(label));
  for (const label of change.add ?? []) {
    if (!kept.includes(label)) kept.push(label);
  }
  return kept;
}
