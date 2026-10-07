import { expect, it } from 'vitest';
import { createPaidInterestTestFixture } from '../replay-paid-interest.test-support';
import { parseReplayRuntimeConfig } from './replay-runtime-config';

const token = (role: string, exp = 1_900_003_600) =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role, exp, iat: 1_900_000_000 })).toString('base64url')}.synthetic`;
const config = () => ({
  environment: 'staging',
  receiptToken: token('pvb_staging_worker'),
  appToken: token('pvb_staging_app_worker'),
  receiptKey: Buffer.alloc(32, 1).toString('base64'),
  receiptSystemId: '7686901100561231906',
  appSystemId: '7685292944002592802',
});

it('accepts a separate paid-interest connection only beside the pinned native factory', () => {
  const sample = createPaidInterestTestFixture();
  expect(parseReplayRuntimeConfig(sample.configuration)).toEqual(
    sample.configuration
  );
});

it('refuses paired paid interest alongside a valid legacy ledger connection', () => {
  const sample = createPaidInterestTestFixture();
  const { ssl: _ssl, ...connection } =
    sample.configuration.paidInterestDatabase;
  expect(() =>
    parseReplayRuntimeConfig({
      ...sample.configuration,
      financialDatabase: {
        ...connection,
        host: 'baci-isolated-savings-db-1',
        role: 'piggyvest_staging_ledger_worker',
      },
    })
  ).toThrow('Staging replay configuration refused');
});

it.each([
  { prefundedReplay: undefined },
  { financialDatabase: {} },
  { interestAccrualSigningSecret: 'synthetic-interest-secret' },
])('refuses mixed authority modes for the separate paid-interest connection', (override) => {
  const sample = createPaidInterestTestFixture();
  expect(() =>
    parseReplayRuntimeConfig({ ...sample.configuration, ...override })
  ).toThrow('Staging replay configuration refused');
});

it.each([
  {
    role: 'piggyvest_staging_ledger_worker',
    host: 'baci-isolated-savings-db-1',
  },
  { role: 'postgres' },
  { ssl: undefined },
  { ssl: { ca: '' } },
  { ssl: { ca: 'synthetic-ca', rejectUnauthorized: false } },
  { host: 'other-host' },
  { integrationId: 'invalid' },
  { extraAuthority: true },
])('refuses broader roles, TLS overrides or unknown paid-interest fields', (override) => {
  const sample = createPaidInterestTestFixture();
  expect(() =>
    parseReplayRuntimeConfig({
      ...sample.configuration,
      paidInterestDatabase: {
        ...sample.configuration.paidInterestDatabase,
        ...override,
      },
    })
  ).toThrow('Staging replay configuration refused');
});

it('accepts only the two pinned staging databases and restricted roles', () => {
  expect(parseReplayRuntimeConfig(config(), 1_900_000_000)).toEqual(config());
});

it('accepts accrual verification only alongside a restricted financial database', () => {
  const configured = {
    ...config(),
    interestAccrualSigningSecret: 'synthetic-interest-secret',
    financialDatabase: {
      host: 'baci-isolated-savings-db-1',
      port: 5432,
      database: 'postgres',
      role: 'piggyvest_staging_ledger_worker',
      password: 'synthetic-password',
      integrationId: '40000000-0000-4000-8000-000000000001',
      businessId: 'business',
    },
  };
  expect(parseReplayRuntimeConfig(configured, 1_900_000_000)).toEqual(
    configured
  );
});

it('rejects accrual verification with the interest-only treasury role', () => {
  expect(() =>
    parseReplayRuntimeConfig(
      {
        ...config(),
        interestAccrualSigningSecret: 'synthetic-interest-secret',
        financialDatabase: {
          host: 'piggyvest-db.staging.baci.internal',
          port: 5432,
          database: 'postgres',
          role: 'prefunded_treasury_operator',
          password: 'synthetic-password',
          integrationId: '40000000-0000-4000-8000-000000000001',
          businessId: 'business',
          ssl: { ca: 'synthetic-ca' },
        },
      },
      1_900_000_000
    )
  ).toThrow('Staging replay configuration refused');
});

it('rejects prefunded bank replay with the paid-interest-only treasury role', () => {
  expect(() =>
    parseReplayRuntimeConfig(
      {
        ...config(),
        prefundedReplay: {
          bundleSha256: 'a'.repeat(64),
          configurationSha256: 'b'.repeat(64),
        },
        financialDatabase: {
          host: 'piggyvest-db.staging.baci.internal',
          port: 5432,
          database: 'postgres',
          role: 'prefunded_treasury_operator',
          password: 'synthetic-password',
          integrationId: '40000000-0000-4000-8000-000000000001',
          businessId: 'business',
          ssl: { ca: 'synthetic-ca' },
        },
      },
      1_900_000_000
    )
  ).toThrow('Staging replay configuration refused');
});

it.each([
  '',
  'too-short',
  's'.repeat(1025),
])('refuses missing or unsafe accrual signing credentials before claims', (interestAccrualSigningSecret) => {
  expect(() =>
    parseReplayRuntimeConfig(
      { ...config(), interestAccrualSigningSecret },
      1_900_000_000
    )
  ).toThrow('Staging replay configuration refused');
});

it('does not enable observations without their restricted database connection', () => {
  expect(() =>
    parseReplayRuntimeConfig(
      {
        ...config(),
        interestAccrualSigningSecret: 'synthetic-interest-secret',
      },
      1_900_000_000
    )
  ).toThrow('Staging replay configuration refused');
});

it('accepts explicit replay activation only with both immutable digest pins', () => {
  const configured = {
    ...config(),
    prefundedReplay: {
      bundleSha256: 'a'.repeat(64),
      configurationSha256: 'b'.repeat(64),
    },
  };
  expect(parseReplayRuntimeConfig(configured, 1_900_000_000)).toEqual(
    configured
  );
});

it.each([
  {},
  { bundleSha256: 'a'.repeat(64) },
  { bundleSha256: 'a'.repeat(64), configurationSha256: 'invalid' },
  {
    bundleSha256: 'a'.repeat(64),
    configurationSha256: 'b'.repeat(64),
    configurationPath: '/tmp/credentials.json',
  },
])('refuses incomplete pins or caller-selected runtime paths', (prefundedReplay) => {
  expect(() =>
    parseReplayRuntimeConfig({ ...config(), prefundedReplay }, 1_900_000_000)
  ).toThrow('Staging replay configuration refused');
});

it.each([
  { environment: 'production' },
  { receiptToken: token('service_role') },
  { appToken: token('authenticated') },
  { receiptSystemId: '1' },
  { appSystemId: '2' },
  { receiptKey: 'bad' },
  { appToken: token('pvb_staging_app_worker', 1_900_000_030) },
  { appToken: token('pvb_staging_app_worker', 1_900_000_120) },
  { appToken: token('pvb_staging_app_worker', 2_000_000_000) },
])('fails closed on unsafe configuration without printing it', (override) => {
  expect(() =>
    parseReplayRuntimeConfig({ ...config(), ...override }, 1_900_000_000)
  ).toThrow('Staging replay configuration refused');
});
