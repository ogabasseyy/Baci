import { productionOrigin } from './production-origins';

// Next's Node entries may bundle this module separately. A process-global slot
// keeps the proxy and application policy consistent within the same process.
const key = Symbol.for('baci.experience.execution-origin');
type RuntimeGlobal = typeof globalThis & { [key]?: { origin: string } };
export function installExperienceExecutionOrigin(value: string) {
  const runtime = globalThis as RuntimeGlobal;
  if (runtime[key]) throw Error('EXECUTION_ORIGIN_ALREADY_INSTALLED');
  const installed = { origin: productionOrigin(value) };
  runtime[key] = installed;
  return () => {
    if (runtime[key] === installed) delete runtime[key];
  };
}
export function getExperienceExecutionOrigin() {
  return (globalThis as RuntimeGlobal)[key]?.origin;
}
