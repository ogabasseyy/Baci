import 'server-only';
import { createOwnerMtlsFetch } from './owner-mtls-fetch';

const OWNER_MTLS_ORIGIN = 'https://builder-owner.usebaci.com';

/** Server-only operator configuration; never derive the destination from a request. */
export function configuredOwnerMtlsFetch(settings: {
  ownerOrigin?: string;
  ownerCert?: string;
  ownerKey?: string;
}) {
  try {
    if (
      settings.ownerOrigin !== OWNER_MTLS_ORIGIN ||
      !settings.ownerCert ||
      !settings.ownerKey
    )
      return undefined;
    return createOwnerMtlsFetch({
      origin: OWNER_MTLS_ORIGIN,
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
