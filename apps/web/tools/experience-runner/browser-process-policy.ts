/** Browser launch policy inside the clean, offline capture worker only.
 * WebKit GC/compiler pools otherwise compete with gVisor's helpers for the
 * unchanged 128-task cgroup limit. Keep every JS/rendering feature enabled;
 * bound parallel housekeeping instead. Unknown JSC options fail closed.
 */
export function browserProcessPolicy(
  engine: 'chromium' | 'firefox' | 'webkit',
  environment: NodeJS.ProcessEnv
): { env?: Record<string, string> } {
  if (engine !== 'webkit') return {};
  const env: Record<string, string> = {};
  for (const name of [
    'PATH',
    'HOME',
    'LANG',
    'TZ',
    'PLAYWRIGHT_BROWSERS_PATH',
  ]) {
    const value = environment[name];
    if (typeof value === 'string') env[name] = value;
  }
  return {
    env: {
      ...env,
      JSC_validateOptions: 'true',
      JSC_numberOfGCMarkers: '1',
      JSC_minNumberOfWorklistThreads: '1',
      JSC_maxNumberOfWorklistThreads: '1',
      JSC_numberOfBaselineCompilerThreads: '1',
      JSC_numberOfDFGCompilerThreads: '1',
      JSC_numberOfFTLCompilerThreads: '1',
      JSC_numberOfWasmCompilerThreads: '1',
    },
  };
}
