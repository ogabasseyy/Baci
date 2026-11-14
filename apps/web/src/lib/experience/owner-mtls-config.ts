import 'server-only';
import { createOwnerMtlsFetch } from './owner-mtls-fetch';
import { productionOrigin } from './production-origins';

/** Server-only operator configuration; never derive the destination from a request. */
export function configuredOwnerMtlsFetch(settings: {
  ownerOrigin?: string;
  ownerCert?: string;
  ownerKey?: string;
}) {
  try {
    if (!settings.ownerOrigin || !settings.ownerCert || !settings.ownerKey)
      return undefined;
    const origin = productionOrigin(settings.ownerOrigin);
    const host = new URL(origin).hostname;
    if (
      !/^[a-z0-9-]+\.usebaci\.com$/.test(host) ||
      [
        'mcp.usebaci.com',
        'auth.usebaci.com',
        'builder-auth.usebaci.com',
      ].includes(host)
    )
      return undefined;
    return createOwnerMtlsFetch({
      origin,
      cert: settings.ownerCert,
      key: settings.ownerKey,
    });
  } catch {
    return undefined;
  }
}

export function ownerMtlsEnvironment() {
  return {
    ownerOrigin: process.env.BACI_OWNER_MTLS_ORIGIN,
    ownerCert: process.env.BACI_OWNER_MTLS_CERT,
    ownerKey: process.env.BACI_OWNER_MTLS_KEY,
  };
}
