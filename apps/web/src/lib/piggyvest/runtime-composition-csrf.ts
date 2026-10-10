import 'server-only';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { runtimeCompositionCsrfSchemas as schemas } from '@/schemas/piggyvest-runtime-composition-csrf';

const processSecret = Uint8Array.from(randomBytes(32));
const lifetimeMs = 900000;
const cookieName = 'piggyvest-csrf';

export function createRuntimeCompositionCsrf(options: {
  origin: string;
  goalId: string;
  secret?: Uint8Array;
  cookiePath?: string;
}) {
  const parsed = schemas.secret.safeParse(options.secret ?? processSecret);
  if (!parsed.success) throw new Error('Local savings runtime unavailable');
  const secret = Buffer.from(parsed.data);
  const cookiePath = schemas.cookiePath.parse(options.cookiePath ?? '/');
  const goalId = schemas.goalId.parse(options.goalId);
  function signature(
    request: NextRequest,
    actorId: string,
    nonce: string,
    expires: number
  ) {
    const cookies = request.cookies
      .getAll()
      .filter((cookie) => cookie.name !== cookieName)
      .map(({ name, value }) => [name, value])
      .sort(([left], [right]) => left.localeCompare(right));
    const binding = createHash('sha256')
      .update(JSON.stringify(cookies))
      .digest('hex');
    return createHmac('sha256', secret)
      .update(
        JSON.stringify([
          options.origin,
          cookiePath,
          goalId,
          actorId,
          binding,
          nonce,
          expires,
        ])
      )
      .digest('base64url');
  }
  return {
    bootstrap(request: NextRequest, actorId: string) {
      const expiresAt = Date.now() + lifetimeMs;
      const nonce = randomBytes(16).toString('hex');
      const csrfToken = `${nonce}.${expiresAt}.${signature(request, actorId, nonce, expiresAt)}`;
      const response = NextResponse.json(
        schemas.bootstrap.parse({ csrfToken, expiresAt }),
        {
          headers: {
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        }
      );
      response.cookies.set(cookieName, csrfToken, {
        httpOnly: true,
        sameSite: 'strict',
        path: cookiePath,
        maxAge: lifetimeMs / 1000,
      });
      return response;
    },
    async check(request: NextRequest, actorId: string) {
      const token = schemas.token.safeParse(
        request.headers.get('x-csrf-token')
      );
      if (
        !token.success ||
        request.headers.get('origin') !== options.origin ||
        request.cookies.get(cookieName)?.value !== token.data
      )
        return { valid: false };
      const [nonce, expiration, supplied] = token.data.split('.');
      const expires = Number(expiration);
      if (expires <= Date.now() || expires > Date.now() + lifetimeMs)
        return { valid: false };
      const expected = signature(request, actorId, nonce, expires);
      if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)))
        return { valid: false };
      const headers = new Headers(request.headers);
      headers.set(
        'cookie',
        `csrf-token=${token.data}; __Host-csrf-token=${token.data}`
      );
      return await checkCsrfProtection(
        new NextRequest(request.url, { method: 'POST', headers })
      );
    },
  };
}
