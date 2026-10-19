import { withPostHogConfig } from '@posthog/nextjs-config';
import type { NextConfig } from 'next';

type ConfigContext = { defaultConfig: NextConfig };
type ConfigFactory = (
  phase: string,
  context?: ConfigContext
) => NextConfig | Promise<NextConfig>;
type ResolvableConfig =
  | NextConfig
  | ((
      phase: string,
      context: ConfigContext
    ) => NextConfig | Promise<NextConfig>);

/** Compose once, then resolve the object or async factory for each Next phase. */
export function composePostHogNextConfig(
  config: NextConfig,
  options?: Parameters<typeof withPostHogConfig>[1]
): ConfigFactory {
  // The vendor declaration says NextConfig, but the enabled runtime returns
  // an async function. Preserve that real contract at this boundary.
  const composed = (
    options ? withPostHogConfig(config, options) : config
  ) as ResolvableConfig;

  return (phase, context = { defaultConfig: {} }) =>
    typeof composed === 'function' ? composed(phase, context) : composed;
}
