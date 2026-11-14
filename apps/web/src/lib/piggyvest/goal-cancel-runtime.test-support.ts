import { createHash } from 'node:crypto';

export const integrationId = '11111111-1111-4111-8111-111111111111';
export const goalId = '55555555-5555-4555-8555-555555555555';
export const operationId = '66666666-6666-4666-8666-666666666666';
export const database = {
  host: 'db.example.com',
  port: 5432,
  name: 'postgres',
  login: 'baci_piggyvest_primary_authorizer',
  password: createHash('sha256').update('s6-db').digest('hex'),
  certificateAuthority: 'test-ca',
};
export const configuration = {
  integrationId,
  environment: 'staging',
  database,
};
export const evidence = {
  integrationId,
  environment: 'staging',
  database: { ...database, login: 'baci_piggyvest_primary_evidence' },
};
export const scope = {
  integrationId,
  environment: 'staging',
  merchantId: '22222222-2222-4222-8222-222222222222',
  customerId: '33333333-3333-4333-8333-333333333333',
  userId: '44444444-4444-4444-8444-444444444444',
  businessId: 'business',
};
export const providerToken = createHash('sha256')
  .update('s6-token')
  .digest('hex');
export const pinProof = createHash('sha256').update('s6-proof').digest('hex');
export const reservation = {
  operationId,
  goalId,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'main-wallet',
  reference: `pvb-cancel-${goalId}`,
  businessId: 'business',
  providerCustomerId: 'customer',
};
