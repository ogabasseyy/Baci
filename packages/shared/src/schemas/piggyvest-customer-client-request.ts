import { piggyvestPolicyClientSchemas } from './piggyvest-policy-client';

export const piggyvestCustomerClientRequestSchema =
  piggyvestPolicyClientSchemas.configuration
    .omit({ endpointPath: true })
    .extend({
      endpointPaths:
        piggyvestPolicyClientSchemas.configuration.shape.endpointPath
          .array()
          .min(1)
          .max(16),
    });
