import { onboardingOptOutTokenSchema } from '@/schemas/merchant-onboarding-email';

const headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
};
function page(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baci setup reminders</title></head><body><main>${body}</main></body></html>`,
    { status, headers }
  );
}
export async function handleOnboardingEmailPreferences(
  request: Request,
  unsubscribe: (token: string) => Promise<void>
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST')
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, POST' },
    });
  try {
    const token =
      request.method === 'POST'
        ? (await request.formData()).get('token')
        : new URL(request.url).searchParams.get('token');
    if (!onboardingOptOutTokenSchema.safeParse(token).success)
      return page('<h1>Invalid reminder link</h1>', 400);
    if (request.method === 'GET')
      return page(
        `<h1>Stop Baci setup reminders?</h1><p>This only stops setup reminders. Account and order messages continue.</p><form method="post"><input type="hidden" name="token" value="${token}"><button type="submit">Stop setup reminders</button></form>`
      );
    await unsubscribe(onboardingOptOutTokenSchema.parse(token));
    return page(
      '<h1>Setup reminders stopped</h1><p>You can continue setting up your store whenever you are ready.</p>'
    );
  } catch {
    return page(
      '<h1>Could not update reminders</h1><p>Please try again later.</p>',
      503
    );
  }
}
