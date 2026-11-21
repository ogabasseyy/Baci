import { storefrontOrigin } from './config.mjs';

// Metadata only: never exposes cookie values.
export async function readChatwootCookieMetadata(context) {
  return (await context.cookies(storefrontOrigin))
    .filter((cookie) => cookie.name.startsWith('cw_'))
    .map(({ name, domain, path: cookiePath, sameSite, secure, httpOnly }) => ({
      name:
        name === 'cw_conversation'
          ? 'conversation'
          : name.startsWith('cw_user_')
            ? 'user'
            : 'other',
      domain,
      path: cookiePath,
      sameSite,
      secure,
      httpOnly,
    }));
}
