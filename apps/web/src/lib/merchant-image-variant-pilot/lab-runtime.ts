import 'server-only';
import type { PilotLabConfig } from './lab-config';

// Instrumentation and route bundles share the Node process, but not necessarily
// a module cache. Keep the validated snapshot in that process's global registry.
const key = Symbol.for('baci.merchant-image-pilot.runtime');
type Registry = typeof globalThis & { [key]?: PilotLabConfig };

function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

export function publishLabRuntime(config: PilotLabConfig): void {
  const registry = globalThis as Registry;
  if (registry[key])
    throw new Error(
      'merchant image pilot: restart to replace the frozen index'
    );
  freeze(config);
  registry[key] = config;
}

export function getFrozenLabRuntime(): PilotLabConfig {
  const config = (globalThis as Registry)[key];
  if (!config)
    throw new Error(
      'merchant image pilot: startup validation has not completed'
    );
  return config;
}
