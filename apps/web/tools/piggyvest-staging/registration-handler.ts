import type { IncomingMessage, ServerResponse } from 'node:http';

const WEBHOOK_PATH = '/api/webhooks/piggyvest';

export default function registrationHandler(
  request: IncomingMessage,
  response: ServerResponse
): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const expectedProject = process.env.PVB_STAGING_REGISTRATION_PROJECT_ID;
  const isStaging =
    process.env.PVB_INTEGRATION_ENV === 'staging' &&
    process.env.VERCEL_ENV === 'production' &&
    Boolean(expectedProject) &&
    process.env.VERCEL_PROJECT_ID === expectedProject;

  if (!isStaging) {
    response.statusCode = 503;
    response.end(JSON.stringify({ error: 'Integration unavailable' }));
    return;
  }

  if (request.url?.split('?')[0] !== WEBHOOK_PATH) {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    response.statusCode = 200;
    response.end(
      request.method === 'HEAD'
        ? undefined
        : JSON.stringify({
            status: 'registration_ready',
            environment: 'staging',
            eventProcessing: 'disabled',
          })
    );
    return;
  }

  if (request.method === 'POST') {
    if (request.headers['x-pvb-signature'] === undefined) {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('OK');
      return;
    }

    response.statusCode = 503;
    response.end(
      JSON.stringify({
        error: 'Webhook processing is not configured',
        code: 'PIGGYVEST_NOT_READY',
      })
    );
    return;
  }

  response.statusCode = 405;
  response.setHeader('Allow', 'GET, HEAD, POST');
  response.end(JSON.stringify({ error: 'Method not allowed' }));
}
