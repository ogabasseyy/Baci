const MAX_RENEWED_SESSION_TOKEN_ALIASES = 8;

/** Remembers concurrent renewal results while keeping the original token usable. */
export function rememberChatwootSessionToken(
  aliases: Set<string>,
  token: string,
  initialToken: string | null
) {
  aliases.delete(token);
  aliases.add(token);
  while (aliases.size > MAX_RENEWED_SESSION_TOKEN_ALIASES + 1) {
    const oldestRenewedToken = [...aliases].find(
      (alias) => alias !== initialToken
    );
    if (!oldestRenewedToken) return;
    aliases.delete(oldestRenewedToken);
  }
}
