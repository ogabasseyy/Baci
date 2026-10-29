const COMMERCE_ACTION =
  /\b(?:cart|checkout|orders?|payments?|paid|pay|transfer|bank|cancel\w*|refund\w*|returns?|exchange\w*|receipt|tracking|track|shipping|parcel|package|arriv\w*|deliver\w*|warrant(?:y|ies)|instal{1,2}ments?|add\s+(?:it|this|that|them|these|those|one))\b/i;
const PERSONAL_DETAILS =
  /\b(?:(?:your|the)\s+(?:[\p{L}-]+\s+){0,3}(?:name|phone|address|email|number|details)|recipient|beneficiary)\b/iu;
const REQUEST_WORD =
  /\b(?:provide|send|share|enter|give|tell|need|confirm|have|get|collect)\b/i;
const INDEPENDENT_TOPIC =
  /^(?:(?:(?:please|can\s+you|could\s+you|would\s+you)\s+)?tell\s+me\s+(?:a|another)\s+(?:joke|story|riddle|fun\s+fact)|(?:what\s+is|what['’]s)\s+(?:artificial\s+intelligence|machine\s+learning|ai)|what\s+can\s+i\s+do\s+to\s+relax|(?:what\s+is|what['’]s)\s+(?:the\s+)?weather(?:\s+in\s+(?:lagos|abuja|nigeria))?)[\s.!?]*$/i;
const LIKELY_PERSONAL =
  /(?:\d[\s().+-]*){7,}|\b(?:my|our)\s+(?:full\s+)?(?:name|phone|address|email|number|account|password|pin|otp)\b/i;
const EXPLICIT_PHONE =
  /\b(?:my|our)\s+(?:phone|mobile|number)(?:\s+number)?\s*(?:is|:|=)\s*\+?\d(?:[\s().+-]*\d){6,14}\b/i;
const EXPLICIT_PROFILE =
  /\b(?:my|our)\s+(?:full\s+)?(?:name|email|address)\s*(?:is|:|=)\s*\S+/i;
const STANDALONE_PHONE = /^\+?(?:\d[\s().+-]*){10,15}$/;
const COURTESY =
  /^(?:hi|hello|hey|thanks|thank\s+you|how\s+are\s+you)[\s.!?]*$/i;
const AFFIRMATIVE = /^(?:yes(?:\s+please)?|yeah|yep|sure|okay|ok)[\s.!?]*$/i;
const ANOTHER_JOKE =
  /(?:^|[.!?]\s+)(?:would\s+you\s+like|do\s+you\s+want)\s+another\s+joke[\s.!?]*$/i;

function containsEmail(text: string): boolean {
  for (
    let index = text.indexOf('@');
    index !== -1;
    index = text.indexOf('@', index + 1)
  ) {
    const before = text[index - 1];
    const after = text[index + 1];
    if (before && after && !/[\s@]/.test(before) && !/[\s@]/.test(after))
      return true;
  }
  return false;
}

function isLikelyPersonal(text: string): boolean {
  return LIKELY_PERSONAL.test(text) || containsEmail(text);
}

function isIndependentTopic(text: string): boolean {
  return INDEPENDENT_TOPIC.test(text.trim());
}

function isSensitiveContext(message: {
  role: 'user' | 'assistant' | 'system';
  content: string;
}): boolean {
  if (message.role === 'user') return COMMERCE_ACTION.test(message.content);
  if (message.role === 'system') return false;
  return (
    (PERSONAL_DETAILS.test(message.content) &&
      (REQUEST_WORD.test(message.content) || message.content.includes('?'))) ||
    (COMMERCE_ACTION.test(message.content) && message.content.includes('?'))
  );
}

export function resolveOgabasseyCommerceContext(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
): {
  guarded: boolean;
  isolateHistory: boolean;
  needsClarification: boolean;
  promptOverride: string | null;
  explicitPersonal: boolean;
} {
  const conversation = messages.filter((message) => message.role !== 'system');
  const last = conversation.at(-1);
  const prior = conversation.slice(0, -1);
  const isolateHistory = prior.some(
    (message) =>
      COMMERCE_ACTION.test(message.content) ||
      isLikelyPersonal(message.content) ||
      (message.role === 'assistant' && isSensitiveContext(message))
  );
  const lastRisk = prior.findLastIndex(isSensitiveContext);
  const lastTopic = prior.findLastIndex(
    (message) => message.role === 'user' && isIndependentTopic(message.content)
  );
  const previous = prior.at(-1);
  const topic = prior[lastTopic];
  const continueJoke =
    isolateHistory &&
    last?.role === 'user' &&
    AFFIRMATIVE.test(last.content.trim()) &&
    previous?.role === 'assistant' &&
    ANOTHER_JOKE.test(previous.content.trim()) &&
    lastTopic > lastRisk &&
    topic?.role === 'user' &&
    /\b(?:a|another)\s+joke\b/i.test(topic.content);
  const currentCommerce =
    last?.role === 'user' && COMMERCE_ACTION.test(last.content);
  const currentPersonal =
    last?.role === 'user' && isLikelyPersonal(last.content);
  const explicitPersonal = Boolean(
    last?.role === 'user' &&
      (EXPLICIT_PHONE.test(last.content) ||
        EXPLICIT_PROFILE.test(last.content) ||
        STANDALONE_PHONE.test(last.content.trim()) ||
        containsEmail(last.content))
  );
  const independent =
    last?.role === 'user' &&
    (isIndependentTopic(last.content) || COURTESY.test(last.content.trim()));
  const guarded = Boolean(
    currentCommerce ||
      currentPersonal ||
      ((lastRisk >= 0 || isolateHistory) && !independent && !continueJoke)
  );
  return {
    guarded,
    isolateHistory,
    needsClarification: guarded && !currentCommerce,
    promptOverride: continueJoke ? 'Tell me another joke.' : null,
    explicitPersonal,
  };
}
