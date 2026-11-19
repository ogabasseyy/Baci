import { readFile } from 'node:fs/promises';
import type { OxygenProbe } from './session';
import { probeStyles, renderProbeUi } from './ui';
export interface HttpConfig {
  origin: string;
  csrf: string;
  environment: 'dev' | 'staging' | 'production';
  configured: boolean;
  requestCreated?: boolean;
  creationLocked?: boolean;
  customerPath?: 'new' | 'existing' | 'unknown';
}
const actions = new Set([
  'login',
  'banks',
  'name-enquiry',
  'prepare-retry',
  'create',
  'validate-existing',
  'validate-new',
  'resend-otp',
  'selfie',
  'kyc',
  'eligibility',
]);
export async function handleProbeRequest(
  request: Request,
  probe: OxygenProbe,
  config: HttpConfig
): Promise<Response> {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  };
  const reply = (body: string, status = 200, type = 'application/json') =>
    new Response(body, {
      status,
      headers: { ...headers, 'Content-Type': type },
    });
  const url = new URL(request.url);
  if (url.origin !== config.origin) return reply('{"code":"forbidden"}', 403);
  if (request.method === 'GET' && url.pathname === '/')
    return reply(renderProbeUi(config), 200, 'text/html; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/style.css')
    return reply(probeStyles, 200, 'text/css');
  if (
    request.method === 'GET' &&
    ['/client.js', '/draft.js'].includes(url.pathname)
  )
    return reply(
      await readFile(new URL(`.${url.pathname}`, import.meta.url), 'utf8'),
      200,
      'text/javascript'
    );
  if (request.method !== 'POST' || url.pathname !== '/action')
    return reply('{"code":"not_found"}', 404);
  if (
    request.headers.get('origin') !== config.origin ||
    request.headers.get('x-probe-csrf') !== config.csrf
  )
    return reply('{"code":"forbidden"}', 403);
  const text = await request.text();
  if (text.length > 16384) return reply('{"code":"too_large"}', 413);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return reply('{"code":"invalid_json"}', 400);
  }
  if (
    typeof data !== 'object' ||
    data === null ||
    !('action' in data) ||
    typeof data.action !== 'string' ||
    !actions.has(data.action)
  )
    return reply('{"code":"unsupported_action"}', 400);
  const input = 'input' in data ? data.input : {};
  return reply(JSON.stringify(await probe.run(data.action, input)));
}
