import { chatwootContextRequestSchemas } from '../../../../../../schemas/chatwoot-context';
import { hasValidFixtureCsrf } from '../../../../fixture-csrf';
import { json } from '../../../../fixture-response';

const sessionToken = 'synthetic-session-capability';

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

  const body = await request.json().catch(() => null);

  if (endpoint === 'challenge') {
    const parsed = chatwootContextRequestSchemas.challenge.safeParse(body);
    if (!parsed.success)
      return json({ error: 'Invalid fixture challenge request' }, 400);
    return validatedJson({
      requestId: parsed.data.requestId,
      widgetOrigin: 'https://support.example.test',
      challengeToken: 'synthetic-challenge-token',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
  }

  if (endpoint === 'verify') {
    const parsed = chatwootContextRequestSchemas.verify.safeParse(body);
    if (!parsed.success)
      return json({ error: 'Invalid fixture verify request' }, 400);
    if (
      parsed.data.challengeToken !== 'synthetic-challenge-token' ||
      parsed.data.contextToken !== 'synthetic-context-token'
    )
      return json({ error: 'Fixture context token did not match' }, 403);
    return validatedJson({
      authorized: true,
      requestId: 'fixture_context_123456',
      conversationId: 905,
      sessionToken,
      sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
    });
  }

  const parsed = chatwootContextRequestSchemas.authorize.safeParse(body);
  if (!parsed.success)
    return json({ error: 'Invalid fixture authorize request' }, 400);
  if (parsed.data.sessionToken !== sessionToken)
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
