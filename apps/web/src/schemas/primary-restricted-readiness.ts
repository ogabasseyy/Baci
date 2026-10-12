import { z } from 'zod';
import { piggyvestPrimaryWalletConfigurationSchema } from './piggyvest-primary-wallet-onboarding';
import { piggyvestPrimaryWalletRuntimeSchema } from './piggyvest-primary-wallet-runtime';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().min(1).max(63);
const environment = piggyvestPrimaryWalletConfigurationSchema.shape.environment;
const businessId = piggyvestPrimaryWalletConfigurationSchema.shape.businessId;
const database = piggyvestPrimaryWalletRuntimeSchema.shape.database.shape;
const origin = z
  .url()
  .max(512)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        url.origin === value &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  });
const roleAttributes = z.strictObject({
  canLogin: z.boolean(),
  superuser: z.boolean(),
  bypassRls: z.boolean(),
  createRole: z.boolean(),
  createDatabase: z.boolean(),
  replication: z.boolean(),
  memberships: z.array(identity).max(20),
});
const role = roleAttributes.extend({
  login: identity,
  capabilityGroup: roleAttributes.extend({ name: identity }),
  validUntil: z.iso.datetime().nullable(),
  schemaUsage: z.boolean(),
  directTableAccess: z.boolean(),
  publicFunctionExecution: z.boolean(),
  executableFunctions: z.array(z.string().min(1).max(200)).max(20),
  databaseName: database.name,
  databaseHost: database.host,
  databasePort: database.port,
  sessionUser: identity,
  currentUser: identity,
  tls: z.boolean(),
  certificateVerified: z.boolean(),
  hostnameVerified: z.boolean(),
});

export const primaryRestrictedReadinessSchema = z.strictObject({
  source: z.enum(['synthetic', 'operator_inventory']),
  capturedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  configuration: z.strictObject({
    environment,
    deploymentEnvironment: z.enum(['production', 'preview', 'development']),
    providerOrigin: origin,
    applicationOrigin: origin,
    merchantId: z.uuid(),
    integrationId: z.uuid(),
    businessId,
    databaseHost: database.host,
    databasePort: database.port,
    databaseName: database.name,
    artifactDigest: digest,
    onboardingRuntimeValidated: z.boolean(),
    provisioningRuntimeValidated: z.boolean(),
    businessBindingVerified: z.boolean(),
  }),
  integration: z.strictObject({
    integrationId: z.uuid(),
    merchantId: z.uuid(),
    businessId,
    environment,
    executorLogin: identity,
    enabled: z.boolean(),
  }),
  goalAuthority: z.strictObject({
    integrationId: z.uuid(),
    executorLogin: identity,
    enabled: z.boolean(),
  }),
  roles: z.array(role).length(2),
  routes: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(200),
        method: z.enum(['GET', 'POST', 'PATCH']),
        handlerModule: z.string().min(1).max(200),
        artifactDigest: digest,
        status: z.int().min(100).max(599),
        authentication: z.literal('unauthenticated'),
        requestBodySent: z.literal(false),
        providerCalls: z.literal(0),
        databaseWrites: z.literal(0),
        applicationOrigin: origin,
        observedAt: z.iso.datetime(),
      })
    )
    .length(4),
  regressionEvidence: z.strictObject({
    artifactDigest: digest,
    authentication: z.boolean(),
    csrf: z.boolean(),
    exactOwnership: z.boolean(),
    singleDispatch: z.boolean(),
    immutableInterestChoice: z.boolean(),
    providerOrigin: z.boolean(),
  }),
});
