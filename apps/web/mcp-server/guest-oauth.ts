import { updateGuestGrant } from './guest-oauth-update-grant';
import { currentGuestCart } from './guest-oauth-cart-lifetime';
import { GUEST_CONNECTION_IDLE_TTL, GUEST_CART_TTL, GUEST_CLOCK_MARGIN, GUEST_REFRESH_MAX_GENERATION } from './config/guest-oauth-lifetime';
import { refreshReceipt, recoverRefresh } from './guest-oauth-refresh-receipt';
import { createGuestConsent } from './guest-oauth-consent';
import { authenticRefreshToken, mintRefreshToken, refreshGrantId } from './guest-oauth-refresh-token';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import {
  guestOAuthAuthorizationSchema,
  guestOAuthTokenRecordSchema,
  guestOAuthAccessRecordSchema,
  guestOAuthCodeRecordSchema,
  guestOAuthConsentRecordSchema,
  guestOAuthExchangeSchema,
  guestOAuthGrantSchema,
  guestOAuthRefreshSchema,
} from '../src/schemas/guest-oauth';
import type { OAuthRecordStore } from './guest-oauth-records';

const ACCESS_TTL = 15 * 60_000;
const CLIENT = 'ogabassey-guest-chatgpt';
const opaque = () => randomBytes(32).toString('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export type GuestOAuthGrant = z.infer<typeof guestOAuthGrantSchema>;

class GrantRevisionConflict extends Error {
  constructor() { super('invalid_grant'); }
}

/** Guest authorization server core. Never derives authority from model input. */
export class GuestOAuth {
  readonly issuer: string;
  readonly resource: string;
  readonly redirectOrigins: readonly string[];
  private readonly now: () => number;
  constructor(
    private readonly options: {
      store: OAuthRecordStore;
      issuer: string;
      resource: string;
      redirects: string[];
      now?: () => number;
    },
  ) {
    this.issuer = options.issuer;
    this.resource = options.resource;
    this.redirectOrigins = [...new Set(options.redirects.map((uri) => new URL(uri).origin))];
    this.now = options.now ?? Date.now;
    for (const url of [options.issuer, options.resource, ...options.redirects]) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.hash || parsed.username || parsed.password)
        throw new Error('Invalid OAuth configuration');
    }
    if (new URL(options.resource).origin !== options.issuer || !options.redirects.length)
      throw new Error('Invalid OAuth configuration');
  }
  private async put(key: string, value: unknown, expiresAt: number) {
    if (!(await this.options.store.compareAndSwap(key, 0, value, expiresAt)))
      throw new Error('temporarily_unavailable');
  }
  private async read(key: string) {
    const record = await this.options.store.read(key);
    if (!record || record.expiresAt <= this.now()) throw new Error('invalid_grant');
    return record;
  }
  private client(client: string, resource: string) {
    if (client !== CLIENT || resource !== this.resource) throw new Error('invalid_client');
  }
  validateAuthorization(input: unknown) {
    const request = guestOAuthAuthorizationSchema.parse(input);
    this.client(request.client_id, request.resource);
    if (!this.options.redirects.includes(request.redirect_uri))
      throw new Error('invalid_redirect_uri');
    return request;
  }
  async beginConsent(input: unknown) {
    const request = this.validateAuthorization(input);
    return createGuestConsent(this.options.store, request, this.now(), this.issuer, this.resource);
  }
  async completeConsent(id: string, cookie: string, allowed: boolean) {
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(cookie))
      throw new Error('invalid_request');
    const key = `consent:${hash(id)}`;
    const row = await this.read(key);
    const consent = guestOAuthConsentRecordSchema.parse(row.value);
    if (
      consent.used ||
      !timingSafeEqual(Buffer.from(hash(cookie)), Buffer.from(consent.cookieHash))
    )
      throw new Error('invalid_request');
    if (
      !(await this.options.store.compareAndSwap(
        key,
        row.revision,
        { ...consent, used: true },
        row.expiresAt,
      ))
    )
      throw new Error('invalid_request');
    if (!allowed)
      return {
        error: 'access_denied',
        state: consent.request.state,
        iss: this.issuer,
        redirectUri: consent.request.redirect_uri,
      };
    return this.authorize(consent.request, consent.connectionRenewable === true);
  }
  async authorize(input: unknown, connectionRenewable = false) {
    const request = this.validateAuthorization(input);
    const code = opaque();
    await this.put(`code:${hash(code)}`, { request, used: false, ...(connectionRenewable ? { connectionRenewable: true } : {}) }, this.now() + 5 * 60_000);
    return {
      code,
      state: request.state,
      iss: this.issuer,
      redirectUri: request.redirect_uri,
    };
  }
  private async issue(grant: GuestOAuthGrant, revision: number) {
    // Bound rotation attempts; replay proof itself occupies only the grant.
    // Legacy refresh indices expire naturally after their existing deadline.
    if (grant.tokenGenerations >= GUEST_REFRESH_MAX_GENERATION) {
      await this.revokeGrant(grant.id);
      throw new Error('invalid_grant');
    }
    if (grant.connectionRenewable) {
      grant = { ...grant, expiresAt: this.now() + GUEST_CONNECTION_IDLE_TTL - GUEST_CLOCK_MARGIN };
    }
    if (revision === 0) {
      if (!(await this.options.store.compareAndSwap(`grant:${grant.id}`, 0, grant, grant.expiresAt)))
        throw new GrantRevisionConflict();
      revision = 1;
    }
    const access = opaque();
    const refreshSigningKey = grant.refreshSigningKey ?? opaque();
    const refresh = mintRefreshToken(grant.id, grant.tokenGenerations + 1, refreshSigningKey);
    const expiresAt = Math.min(this.now() + ACCESS_TTL, grant.expiresAt);
    const next = { ...grant, refreshSigningKey, refreshHash: hash(refresh), tokenGenerations: grant.tokenGenerations + 1 };
    const receipt = refreshReceipt(grant, access, refresh, expiresAt, this.now());
    if (receipt) next.refreshReceipt = { ...receipt, nextHash: next.refreshHash };
    // Token indices precede grant CAS: partial writes never authorize a token
    // with a refresh hash other than the committed generation.
    await this.put(
      `access:${hash(access)}`,
      { grantId: grant.id, expiresAt, generation: next.refreshHash },
      expiresAt,
    );
    if (
      !(await this.options.store.compareAndSwap(
        `grant:${grant.id}`,
        revision,
        next,
        grant.expiresAt,
      ))
    )
      throw new GrantRevisionConflict();
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer' as const,
      expires_in: Math.max(0, Math.floor((expiresAt - this.now()) / 1000)),
      scope: 'cart:write',
    };
  }
  async exchange(input: unknown) {
    const request = guestOAuthExchangeSchema.parse(input);
    this.client(request.client_id, request.resource);
    const key = `code:${hash(request.code)}`;
    const row = await this.read(key);
    const code = guestOAuthCodeRecordSchema.parse(row.value);
    const challenge = createHash('sha256').update(request.code_verifier).digest('base64url');
    if (
      code.used ||
      code.request.client_id !== request.client_id ||
      code.request.resource !== request.resource ||
      code.request.redirect_uri !== request.redirect_uri ||
      !timingSafeEqual(Buffer.from(challenge), Buffer.from(code.request.code_challenge))
    )
      throw new Error('invalid_grant');
    if (
      !(await this.options.store.compareAndSwap(
        key,
        row.revision,
        { ...code, used: true },
        row.expiresAt,
      ))
    )
      throw new Error('invalid_grant');
    return this.issue(
      {
        id: randomUUID(),
        clientId: request.client_id,
        resource: request.resource,
        // Keep the absolute bound below the database deadline under small clock skew.
        expiresAt: this.now() + (code.connectionRenewable ? GUEST_CONNECTION_IDLE_TTL : GUEST_CART_TTL) - GUEST_CLOCK_MARGIN,
        ...(code.connectionRenewable ? { connectionRenewable: true as const } : {}),
        cartExpiresAt: this.now() + GUEST_CART_TTL - GUEST_CLOCK_MARGIN,
        revoked: false,
        refreshHash: '',
        tokenGenerations: 0,
        cartToken: opaque(),
        cartInitialized: false,
      },
      0,
    );
  }
  private async grant(id: string) {
    const row = await this.read(`grant:${id}`);
    const grant = guestOAuthGrantSchema.parse(row.value);
    this.client(grant.clientId, grant.resource);
    if (grant.revoked || grant.expiresAt <= this.now()) throw new Error('invalid_grant');
    return { row, grant };
  }
  async verify(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('invalid_token');
    const row = await this.read(`access:${hash(token)}`);
    const access = guestOAuthAccessRecordSchema.parse(row.value);
    const { grant } = await this.grant(access.grantId);
    if (access.expiresAt <= this.now() || access.generation !== grant.refreshHash)
      throw new Error('invalid_token');
    return grant;
  }
  async refresh(input: unknown) {
    const request = guestOAuthRefreshSchema.parse(input);
    this.client(request.client_id, request.resource);
    const compactId = refreshGrantId(request.refresh_token);
    // Existing opaque QA tokens migrate on their next successful rotation.
    const grantId = compactId ?? guestOAuthTokenRecordSchema.parse(
      (await this.read(`refresh:${hash(request.refresh_token)}`)).value,
    ).grantId;
    for (let retry = 0; retry < 3; retry++) {
      const { row: current, grant } = await this.grant(grantId);
      if (compactId && !authenticRefreshToken(request.refresh_token, grant.id, grant.refreshSigningKey))
        throw new Error('invalid_grant');
      const recovered = recoverRefresh(grant, hash(request.refresh_token), this.now());
      if (recovered) return recovered;
      if (grant.refreshHash !== hash(request.refresh_token)) {
        await this.revokeGrant(grant.id);
        throw new Error('invalid_grant');
      }
      try {
        return await this.issue(grant, current.revision);
      } catch (error) {
        // Re-read committed receipts or unrelated grant updates before retrying.
        if (!(error instanceof GrantRevisionConflict)) throw error;
      }
    }
    throw new Error('temporarily_unavailable');
  }
  private async revokeGrant(id: string) {
    for (let retry = 0; retry < 3; retry++) {
      const row = await this.read(`grant:${id}`);
      const grant = guestOAuthGrantSchema.parse(row.value);
      this.client(grant.clientId, grant.resource);
      if (grant.revoked) return;
      if (
        await this.options.store.compareAndSwap(
          `grant:${id}`,
          row.revision,
          { ...grant, revoked: true },
          grant.expiresAt,
        )
      )
        return;
    }
    throw new Error('temporarily_unavailable');
  }
  async revoke(token: string, clientId: string) {
    if (clientId !== CLIENT) return;
    const compactId = refreshGrantId(token);
    if (compactId) {
      const row = await this.options.store.read(`grant:${compactId}`);
      if (!row || row.expiresAt <= this.now()) return;
      const grant = guestOAuthGrantSchema.parse(row.value);
      this.client(grant.clientId, grant.resource);
      if (authenticRefreshToken(token, grant.id, grant.refreshSigningKey))
        await this.revokeGrant(grant.id);
      return;
    }
    if (!/^[a-f0-9]{64}$/.test(token)) return;
    for (const prefix of ['refresh', 'access']) {
      const row = await this.options.store.read(`${prefix}:${hash(token)}`);
      if (!row || row.expiresAt <= this.now()) continue;
      const record = guestOAuthTokenRecordSchema.parse(row.value);
      await this.revokeGrant(record.grantId);
      return;
    }
  }
  async currentCart(accessToken: string) {
    return currentGuestCart(this, accessToken, this.now());
  }
  async updateGrant(grantId: string, update: (grant: GuestOAuthGrant) => GuestOAuthGrant) {
    return updateGuestGrant(this.options.store, await this.grant(grantId), update);
  }
}
