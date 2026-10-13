import 'server-only';

const STAGING_ORIGIN = 'https://staging.ogabassey.com';
const STAGING_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
const STAGING_ANON_KEY_SHA256 =
  '1065d3a5c300f1d3ba3d6c42cbe0524128c57cc2032a4345bff4100cb6f7a3f2';

type CustomerSavingsDraftRuntime = {
  requestOrigin: string;
  nodeEnv: string | undefined;
  supabaseUrl: string | undefined;
  supabaseAnonKeySha256: string | undefined;
  stagingEnabled: string | undefined;
  workerProfile?: string;
  host?: string;
  forwardedHost?: string;
  forwardedProto?: string;
};

function localSupabaseRuntime(url: string | undefined): boolean {
  try {
    const parsed = new URL(url ?? '');
    return (
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export function customerSavingsDraftRuntimeEnabled(
  runtime: CustomerSavingsDraftRuntime
): boolean {
  if (
    runtime.nodeEnv !== 'production' &&
    localSupabaseRuntime(runtime.supabaseUrl)
  )
    return true;
  const isolatedProxyOrigin =
    runtime.nodeEnv === 'production' &&
    runtime.workerProfile === 'hosted-savings-drafts' &&
    runtime.requestOrigin === 'https://localhost:4792' &&
    runtime.host === 'staging.ogabassey.com' &&
    runtime.forwardedHost === 'staging.ogabassey.com' &&
    runtime.forwardedProto === 'https';
  return (
    (runtime.requestOrigin === STAGING_ORIGIN || isolatedProxyOrigin) &&
    runtime.supabaseUrl === STAGING_SUPABASE_URL &&
    runtime.supabaseAnonKeySha256 === STAGING_ANON_KEY_SHA256 &&
    runtime.stagingEnabled === 'true'
  );
}
