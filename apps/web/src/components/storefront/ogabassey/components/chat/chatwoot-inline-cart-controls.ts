import type { ChatwootCartReviewSnapshot } from './chatwoot-inline-review';

export function postChatwootCanonicalCartView(input: {
  requestId: string;
  snapshot: ChatwootCartReviewSnapshot;
  lineTokens: Map<string, string>;
  post: (payload: string) => void;
}) {
  const { requestId, snapshot, lineTokens, post } = input;
  lineTokens.clear();
  const items = snapshot.items.map((item) => {
    const lineToken = crypto.randomUUID();
    lineTokens.set(lineToken, item.lineId);
    return {
      lineToken,
      name: item.name,
      quantity: item.quantity,
      condition: item.condition ?? '',
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
    };
  });
  post(`baci-cart-view:${JSON.stringify({
    requestId,
    ready: true,
    count: items.reduce((total, item) => total + item.quantity, 0),
    currency: snapshot.currency,
    cartVersion: snapshot.cartVersion,
    estimatedTotals: snapshot.estimatedTotals,
    items,
    truncated: false,
  })}`);
}
