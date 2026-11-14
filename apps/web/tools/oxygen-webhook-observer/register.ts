import { randomBytes } from 'node:crypto';
import {
  inspectRegistrationReceipt,
  type RegistrationDiagnostic,
} from './receipt';

export interface RegistrationInput {
  operation?: 'create' | 'update';
  callback: string;
  reference: string;
  secret: string;
  callbackCredentials?: { apiKey: string; apiSecret: string };
}
export async function registerStagingObserver(
  input: RegistrationInput,
  deps: {
    fetchImpl: typeof fetch;
    login: (reference: string, secret: string) => Promise<string>;
  }
): Promise<{
  status: number;
  registration: 'confirmed' | 'unconfirmed';
  diagnostic: RegistrationDiagnostic;
}> {
  const callback = new URL(input.callback);
  if (
    callback.protocol !== 'https:' ||
    !callback.hostname.endsWith('.trycloudflare.com') ||
    !['/oxygen-staging-hook', '/api/payments/oxygen/webhook'].includes(
      callback.pathname
    ) ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password ||
    callback.port ||
    !input.reference ||
    !input.secret ||
    (input.callbackCredentials &&
      (!input.callbackCredentials.apiKey.trim() ||
        !input.callbackCredentials.apiSecret.trim()))
  ) {
    throw new Error('Invalid staging observer configuration.');
  }
  const token = await deps.login(input.reference, input.secret);
  const payload = {
    partner_reference: input.reference,
    webhook_url: callback.href,
    api_key:
      input.callbackCredentials?.apiKey ?? randomBytes(32).toString('hex'),
    api_secret:
      input.callbackCredentials?.apiSecret ?? randomBytes(32).toString('hex'),
    auth_type: 'API_KEY',
    ...(input.operation === 'update' ? { active: true } : {}),
    custom_headers: {
      'x-oxygen-probe': 'baci-staging-observer',
      'x-environment': 'uat',
    },
  };
  const response = await deps.fetchImpl(
    `https://staging-api.theoxygen.com/services/partners/api/v1/webhook-partners/${input.operation ?? 'create'}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify(payload),
    }
  );
  // Never automatically retry or switch operation after a provider failure.
  const receipt = await inspectRegistrationReceipt(response, payload, [
    token,
    input.secret,
    payload.api_key,
    payload.api_secret,
  ]);
  return { status: response.status, ...receipt };
}
