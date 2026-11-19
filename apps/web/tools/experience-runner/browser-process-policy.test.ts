import { expect, it } from 'vitest';
import { browserProcessPolicy } from './browser-process-policy';

it('bounds WebKit background thread pools without disabling JIT, rendering or source features', () => {
  const options = browserProcessPolicy('webkit', { PATH: '/usr/local/bin' });
  expect(options.env?.JSC_numberOfGCMarkers).toBe('1');
  expect(options.env?.JSC_maxNumberOfWorklistThreads).toBe('1');
  expect(options.env?.JSC_numberOfBaselineCompilerThreads).toBe('1');
  expect(options.env?.JSC_numberOfDFGCompilerThreads).toBe('1');
  expect(options.env?.JSC_numberOfFTLCompilerThreads).toBe('1');
  expect(options.env?.JSC_numberOfWasmCompilerThreads).toBe('1');
  expect(options.env).not.toHaveProperty('JSC_useJIT');
  expect(options.env).not.toHaveProperty('JSC_useConcurrentJIT');
  expect(options.env).not.toHaveProperty('WEBKIT_DISABLE_COMPOSITING_MODE');
});

it('forwards only sandbox launch variables and leaves other browser policies unchanged', () => {
  const environment = {
    PATH: '/usr/local/bin',
    HOME: '/tmp',
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
    OPENAI_API_KEY: 'synthetic-forbidden',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-forbidden',
    NODE_OPTIONS: '--synthetic-forbidden',
  };
  const { env } = browserProcessPolicy('webkit', environment);
  expect(env?.HOME).toBe('/tmp');
  expect(env?.PLAYWRIGHT_BROWSERS_PATH).toBe('/ms-playwright');
  expect(env).not.toHaveProperty('OPENAI_API_KEY');
  expect(env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
  expect(env).not.toHaveProperty('NODE_OPTIONS');
  expect(browserProcessPolicy('chromium', environment)).toEqual({});
  expect(browserProcessPolicy('firefox', environment)).toEqual({});
});
