import { piggyvestPolicyClientSchemas } from './piggyvest-policy-client';

export const piggyvestCancellationClientSchema =
  piggyvestPolicyClientSchemas.configuration
    .extend({
      recoveryEndpointPath:
        piggyvestPolicyClientSchemas.configuration.shape.endpointPath,
    })
    .refine(
      (value) =>
        value.endpointPath !== value.recoveryEndpointPath &&
        !value.endpointPath.startsWith(`${value.recoveryEndpointPath}/`) &&
        !value.recoveryEndpointPath.startsWith(`${value.endpointPath}/`)
    );
