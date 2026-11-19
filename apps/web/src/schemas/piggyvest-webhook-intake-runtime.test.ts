import { describe, expect, it } from 'vitest';
import { piggyvestWebhookIntakeRuntimeSchema as schema } from './piggyvest-webhook-intake-runtime';

const SECRET = 'S3cret-pass-do-not-echo';
const valid = () => ({
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_webhook_intake' as const,
    password: SECRET,
    certificateAuthority:
      '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
  },
});

describe('piggyvestWebhookIntakeRuntimeSchema', () => {
  it('accepts a complete configuration', () => {
    expect(schema.safeParse(valid()).success).toBe(true);
  });

  it.each([
    'host',
    'port',
    'name',
    'login',
    'password',
    'certificateAuthority',
  ])('rejects a missing %s', (field) => {
    const input = valid();
    delete (input.database as Record<string, unknown>)[field];
    expect(schema.safeParse(input).success).toBe(false);
  });

  it('rejects a missing database block', () => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it.each([
    'baci_piggyvest_primary_provisioner',
    'postgres',
    'service_role',
    '',
  ])('rejects the login %s', (login) => {
    const input = valid();
    expect(
      schema.safeParse({ database: { ...input.database, login } }).success
    ).toBe(false);
  });

  it.each([
    ['host', '/tmp/db'],
    ['host', 'localhost'],
    ['port', 0],
    ['port', 65536],
    ['port', 5432.5],
    ['name', 'Bad-Name'],
    ['name', ''],
    ['password', ''],
    ['certificateAuthority', ''],
  ])('rejects malformed %s %j', (field, value) => {
    const input = valid();
    expect(
      schema.safeParse({ database: { ...input.database, [field]: value } })
        .success
    ).toBe(false);
  });

  it('rejects unknown keys at both levels', () => {
    const input = valid();
    expect(schema.safeParse({ ...input, extra: 1 }).success).toBe(false);
    expect(
      schema.safeParse({ database: { ...input.database, extra: 1 } }).success
    ).toBe(false);
  });

  it('never echoes the password in validation errors', () => {
    const input = valid();
    const result = schema.safeParse({
      database: { ...input.database, port: 'x', login: 'nope', extra: SECRET },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain(SECRET);
  });
});
