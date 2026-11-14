import { describe, expect, it, vi } from 'vitest';
import {
  isPiggyvestWebhookIntakeRuntimeReady,
  readPiggyvestWebhookIntakeRuntime,
} from './webhook-intake-runtime';

vi.mock('server-only', () => ({}));

const complete = {
  PIGGYVEST_PRIMARY_DB_HOST: 'db.example.com',
  PIGGYVEST_PRIMARY_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_DB_NAME: 'postgres',
  PIGGYVEST_PRIMARY_DB_CA: 'test-ca',
  PIGGYVEST_WEBHOOK_INTAKE_DB_PASSWORD: 'test-only',
} as unknown as NodeJS.ProcessEnv;

describe('readPiggyvestWebhookIntakeRuntime', () => {
  it('binds the fixed restricted login to the shared database settings', () => {
    expect(readPiggyvestWebhookIntakeRuntime(complete).database).toEqual({
      host: 'db.example.com',
      port: 5432,
      name: 'postgres',
      login: 'baci_piggyvest_webhook_intake',
      password: 'test-only',
      certificateAuthority: 'test-ca',
    });
  });

  it.each([
    'PIGGYVEST_PRIMARY_DB_HOST',
    'PIGGYVEST_PRIMARY_DB_PORT',
    'PIGGYVEST_PRIMARY_DB_NAME',
    'PIGGYVEST_PRIMARY_DB_CA',
    'PIGGYVEST_WEBHOOK_INTAKE_DB_PASSWORD',
  ])('fails closed when %s is unset', (key) => {
    const env = { ...complete, [key]: undefined } as NodeJS.ProcessEnv;
    expect(() => readPiggyvestWebhookIntakeRuntime(env)).toThrow(
      'PiggyVest webhook intake database unavailable'
    );
  });

  it('fails closed on an unusable host, even with every variable set', () => {
    const env = {
      ...complete,
      PIGGYVEST_PRIMARY_DB_HOST: 'localhost',
    } as NodeJS.ProcessEnv;
    expect(() => readPiggyvestWebhookIntakeRuntime(env)).toThrow();
  });
});

it('reports the same fail-closed readiness used by capture workers', () => {
  expect(isPiggyvestWebhookIntakeRuntimeReady(complete)).toBe(true);
  expect(isPiggyvestWebhookIntakeRuntimeReady({ NODE_ENV: 'test' })).toBe(
    false
  );
});
