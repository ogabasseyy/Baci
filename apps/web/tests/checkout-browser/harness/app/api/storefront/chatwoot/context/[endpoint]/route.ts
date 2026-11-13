import { hasValidFixtureCsrf } from '../../../../fixture-csrf';
import { json } from '../../../../fixture-response';

const sessionToken = 'synthetic-session-capability';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatedJson(body: unknown) {
  const response = json(body);
  response.headers.set('x-fixture-csrf-cookie-validated', 'true');
  return response;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ endpoint: string }> }
) {
  const { endpoint } = await context.params;
  const url = new URL(request.url);
  if (
    !['challenge', 'verify', 'authorize'].includes(endpoint) ||
    url.searchParams.size !== 1 ||
    url.searchParams.get('merchantSlug') !== 'ogabassey'
  )
    return json({ error: 'Fixture context request did not match' }, 404);
  if (!hasValidFixtureCsrf(request))
    return json({ error: 'Fixture CSRF validation failed' }, 403);

  const parsedBody = await request.json().catch(() => null);
  if (!isRecord(parsedBody))
    return json({ error: 'Invalid fixture context request' }, 400);

  if (endpoint === 'challenge')
    return validatedJson({
      requestId: parsedBody.requestId,
      widgetOrigin: 'https://support.example.test',
      challengeToken: 'synthetic-challenge-token',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });

  if (
    endpoint === 'verify' &&
    (parsedBody.challengeToken !== 'synthetic-challenge-token' ||
      parsedBody.contextToken !== 'synthetic-context-token')
  )
    return json({ error: 'Fixture context token did not match' }, 403);

  if (endpoint === 'verify')
    return validatedJson({
      authorized: true,
      requestId: 'fixture_context_123456',
      conversationId: 905,
      sessionToken,
      sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
    });

  if (
    parsedBody.sessionToken !== sessionToken ||
    parsedBody.includeCartSnapshot !== true
  )
    return json({ error: 'Fixture session token did not match' }, 403);

  return validatedJson({
    authorized: true,
    conversationId: 905,
    sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
    cartSnapshot: {
      cartVersion: 8,
      currency: 'NGN',
      estimatedTotals: false,
      items: [
        {
          lineId: 'server-line-1',
          name: 'Canonical server phone',
          productId: 'server-product-1',
          variantId: null,
          condition: null,
          quantity: 2,
          unitPriceMinor: 125000,
          lineTotalMinor: 250000,
        },
      ],
      itemsSubtotalMinor: 250000,
    },
  });
}
