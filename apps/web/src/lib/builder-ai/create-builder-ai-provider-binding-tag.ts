import { createHmac } from 'node:crypto';

const PROVIDER_BINDING_DOMAIN = 'baci-builder-ai-provider-binding';
const PROVIDER_BINDING_VERSION = 'v1';
const MINIMUM_BINDING_PEPPER_BYTES = 32;

export interface BuilderAiProviderBindingInput {
  accountRef: string;
  approvedModel: string;
  deploymentTier: string;
  key: string;
  providerName: string;
  releaseAttestedAt: string | undefined;
}

/**
 * Creates the deployment attestation tag consumed by the Builder provider
 * catalog. It binds deployment metadata to the active provider credential; it
 * does not verify provider-side account ownership or tier.
 */
export function createBuilderAiProviderBindingTag(
  input: BuilderAiProviderBindingInput,
  bindingPepper: string
): string | null {
  if (
    !input.accountRef ||
    !input.approvedModel ||
    !input.deploymentTier ||
    !input.key ||
    !input.providerName ||
    !bindingPepper ||
    Buffer.byteLength(bindingPepper, 'utf8') < MINIMUM_BINDING_PEPPER_BYTES
  ) {
    return null;
  }

  const canonicalPayload = JSON.stringify([
    PROVIDER_BINDING_DOMAIN,
    PROVIDER_BINDING_VERSION,
    input.providerName,
    input.key,
    input.accountRef,
    input.deploymentTier,
    input.approvedModel,
    input.releaseAttestedAt,
  ]);
  return createHmac('sha256', bindingPepper)
    .update(canonicalPayload)
    .digest('hex');
}
