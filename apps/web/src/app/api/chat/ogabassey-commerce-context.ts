const COMMERCE_ACTION =
  /\b(?:cart|checkout|orders?|payments?|paid|pay|transfer|bank|cancel\w*|refund\w*|returns?|exchange\w*|receipt|tracking|track|shipping|parcel|package|arriv\w*|deliver\w*|warrant(?:y|ies)|instal{1,2}ments?|add\s+(?:it|this|that|them|these|those|one))\b/i;

export function hasRecentCommerceContext(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
): boolean {
  return messages
    .filter((message) => message.role !== 'system')
    .slice(-6)
    .some((message) => COMMERCE_ACTION.test(message.content));
}
