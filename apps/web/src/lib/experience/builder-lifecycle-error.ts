type BuilderLifecyclePhase =
  | 'identity'
  | 'private-config'
  | 'configuration'
  | 'nonce-store'
  | 'renderer-store'
  | 'stack'
  | 'host'
  | 'mcp-listener'
  | 'owner-listener'
  | 'delivery-listener'
  | 'database-pool';

export class BuilderLifecycleError extends Error {
  constructor(
    code:
      | 'BUILDER_STARTUP_FAILED'
      | 'BUILDER_BOOT_FAILED'
      | 'BUILDER_SHUTDOWN_FAILED'
      | 'BUILDER_STACK_STARTUP_FAILED'
      | 'BUILDER_STACK_SHUTDOWN_FAILED',
    readonly phase: BuilderLifecyclePhase
  ) {
    super(code);
  }
}

export function builderLifecyclePhase(error: unknown) {
  return error instanceof BuilderLifecycleError ? error.phase : 'unknown';
}
