import { type GatewayConfig, loadGatewayConfig } from './config';
import type { StartedGateway } from './server';

type StartGateway = (config: GatewayConfig) => Promise<StartedGateway>;

export function runGatewayCli(startGatewayServer: StartGateway): void {
  let config: GatewayConfig;
  try {
    config = loadGatewayConfig(process.env);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'startup_failed';
    process.stderr.write(`gateway startup failed: ${message}\n`);
    process.exit(1);
  }
  let gateway: StartedGateway | null = null;
  startGatewayServer(config).then(
    (started) => {
      gateway = started;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : 'startup_failed';
      process.stderr.write(`gateway startup failed: ${message}\n`);
      process.exit(1);
    }
  );
  const shutdown = () => {
    const active = gateway;
    if (active) {
      void active.close().finally(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
