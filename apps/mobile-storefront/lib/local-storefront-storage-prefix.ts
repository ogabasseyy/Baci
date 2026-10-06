interface LocalStorageEnvironment {
  mode?: string;
  apiUrl?: string;
  supabaseUrl?: string;
}

function originNamespace(value: string | undefined): string {
  const match = value?.match(/^(https?):\/\/([0-9.]+):([1-9][0-9]{0,4})\/?$/);
  if (!match)
    throw new Error('Local storage requires explicit private LAN origins');
  const octets = match[2].split('.').map(Number);
  const [first, second] = octets;
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255
    ) ||
    octets.join('.') !== match[2] ||
    Number(match[3]) > 65535 ||
    !(
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    )
  )
    throw new Error('Local storage requires explicit private LAN origins');
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function getLocalStorefrontStoragePrefix(
  environment: LocalStorageEnvironment = {
    mode: process.env.EXPO_PUBLIC_LOCAL_STOREFRONT,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  },
  development = typeof __DEV__ !== 'undefined' && __DEV__
): string {
  if (
    environment.mode === undefined ||
    environment.mode === '' ||
    environment.mode === '0'
  )
    return '';
  if (environment.mode !== '1' || !development)
    throw new Error('Local storefront storage is development-only');
  const supabase = originNamespace(environment.supabaseUrl);
  const api = originNamespace(environment.apiUrl);
  if (supabase === api)
    throw new Error('Local API and Supabase origins must be distinct');
  return `baci-local-${supabase}-${api}.`;
}
