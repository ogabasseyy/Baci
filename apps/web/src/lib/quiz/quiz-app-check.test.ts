// @vitest-environment node
import { generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  type QuizAppCheckConfig,
  verifyQuizAppCheckToken,
} from './quiz-app-check';

const PROJECT_NUMBER = '499767419832';
const APP_ID = '1:499767419832:android:00f5a4e17f8054d2f8a54d';
const config: QuizAppCheckConfig = {
  allowedAppIds: [APP_ID],
  projectNumber: PROJECT_NUMBER,
};
const NOW = new Date('2026-11-02T10:00:00Z');
const nowSeconds = Math.floor(NOW.getTime() / 1000);

async function signedToken(
  overrides: {
    aud?: string[];
    exp?: number;
    iss?: string;
    key?: CryptoKey;
    sub?: string;
  } = {}
) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
    .setIssuer(
      overrides.iss ??
        `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`
    )
    .setAudience(overrides.aud ?? [`projects/${PROJECT_NUMBER}`])
    .setSubject(overrides.sub ?? APP_ID)
    .setIssuedAt(nowSeconds - 60)
    .setExpirationTime(overrides.exp ?? nowSeconds + 3600)
    .sign(overrides.key ?? privateKey);
  return { publicKey, token };
}

describe('verifyQuizAppCheckToken', () => {
  it('accepts a token signed by the Firebase key for an allowed app', async () => {
    const { publicKey, token } = await signedToken();

    await expect(
      verifyQuizAppCheckToken(token, config, {
        keyResolver: async () => publicKey,
        now: NOW,
      })
    ).resolves.toMatchObject({ ok: true });
  });

  it('rejects a missing token', async () => {
    await expect(
      verifyQuizAppCheckToken(null, config, { now: NOW })
    ).resolves.toEqual({ ok: false, reason: 'missing_token' });
  });

  it('fails closed when the project is not configured', async () => {
    const { publicKey, token } = await signedToken();

    await expect(
      verifyQuizAppCheckToken(
        token,
        { allowedAppIds: [], projectNumber: '' },
        { keyResolver: async () => publicKey, now: NOW }
      )
    ).resolves.toEqual({ ok: false, reason: 'not_configured' });
  });

  it('rejects a token signed by a different key', async () => {
    const { token } = await signedToken();
    const { publicKey: otherKey } = await generateKeyPair('RS256');

    await expect(
      verifyQuizAppCheckToken(token, config, {
        keyResolver: async () => otherKey,
        now: NOW,
      })
    ).resolves.toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('rejects an expired token', async () => {
    const { publicKey, token } = await signedToken({ exp: nowSeconds - 10 });

    await expect(
      verifyQuizAppCheckToken(token, config, {
        keyResolver: async () => publicKey,
        now: NOW,
      })
    ).resolves.toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('rejects a token issued for another Firebase project', async () => {
    const { publicKey, token } = await signedToken({
      aud: ['projects/111'],
      iss: 'https://firebaseappcheck.googleapis.com/111',
    });

    await expect(
      verifyQuizAppCheckToken(token, config, {
        keyResolver: async () => publicKey,
        now: NOW,
      })
    ).resolves.toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('rejects a token for an app that is not the Ogabassey app', async () => {
    const { publicKey, token } = await signedToken({
      sub: '1:499767419832:android:deadbeef',
    });

    await expect(
      verifyQuizAppCheckToken(token, config, {
        keyResolver: async () => publicKey,
        now: NOW,
      })
    ).resolves.toEqual({ ok: false, reason: 'app_not_allowed' });
  });
});
