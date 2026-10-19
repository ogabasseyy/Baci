import { parseSearchAssistanceProposal } from '@baci/shared/lib';
/** Accept a JSON envelope, optionally fenced by a provider; retain strict domain validation. */
export function parseModelProposal(text: string) {
  if (text.length > 8192) throw new Error('Proposal too large');
  const json = text
    .trim()
    .replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1');
  return parseSearchAssistanceProposal(JSON.parse(json));
}
