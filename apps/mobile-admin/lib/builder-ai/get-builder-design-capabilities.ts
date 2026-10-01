import { builderDesignCapabilities } from '@baci/shared/contracts';

export function getBuilderDesignCapabilities() {
  return {
    hash: builderDesignCapabilities.capabilityHash,
    manifest: builderDesignCapabilities,
  };
}
