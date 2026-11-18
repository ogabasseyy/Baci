export interface CloudflareCfMetadata {
  asn?: number | string;
  asOrganization?: string;
  colo?: string;
  country?: string;
}

export type VerifiedCarrierKey = 'MTN' | 'Airtel' | 'Glo' | '9mobile' | 'Other';

export interface VerifiedNetworkInfo {
  asn: number;
  asOrganization: string;
  colo: string;
  country: string;
  verifiedNetwork: string;
  verifiedCarrierKey: VerifiedCarrierKey;
}

function parseAsn(raw: number | string | undefined): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    return Number.parseInt(raw.trim(), 10);
  }
  return 0;
}

export function extractCfMetadata(request: Request): {
  asn: number;
  asOrganization: string;
  colo: string;
  country: string;
} {
  const cf = (request as Request & { cf?: CloudflareCfMetadata }).cf;
  const asn = parseAsn(cf?.asn);
  const asOrganization =
    typeof cf?.asOrganization === 'string' ? cf.asOrganization.trim() : '';
  const colo = (typeof cf?.colo === 'string' ? cf.colo.trim() : '') || 'LOCAL';
  const country =
    (typeof cf?.country === 'string' ? cf.country.trim() : '') || 'XX';
  return { asn, asOrganization, colo, country };
}

/**
 * Classifies Cloudflare edge `request.cf` ASN/organization into Nigerian mobile
 * carriers or falls back to `<asOrganization || 'Unknown ISP'> (AS<asn || 0>)`.
 */
export function classifyVerifiedNetwork(request: Request): VerifiedNetworkInfo {
  const { asn, asOrganization, colo, country } = extractCfMetadata(request);

  if (asn === 29465 || /\bmtn\b/i.test(asOrganization)) {
    return {
      asn,
      asOrganization,
      colo,
      country,
      verifiedNetwork: 'MTN Nigeria',
      verifiedCarrierKey: 'MTN',
    };
  }
  if (asn === 36873 || /\bairtel\b/i.test(asOrganization)) {
    return {
      asn,
      asOrganization,
      colo,
      country,
      verifiedNetwork: 'Airtel Nigeria',
      verifiedCarrierKey: 'Airtel',
    };
  }
  if (
    asn === 328309 ||
    asn === 29571 ||
    /\b(globacom|glo)\b/i.test(asOrganization)
  ) {
    return {
      asn,
      asOrganization,
      colo,
      country,
      verifiedNetwork: 'Glo Nigeria',
      verifiedCarrierKey: 'Glo',
    };
  }
  if (asn === 37076 || /\b(emts|9mobile)\b/i.test(asOrganization)) {
    return {
      asn,
      asOrganization,
      colo,
      country,
      verifiedNetwork: '9mobile Nigeria',
      verifiedCarrierKey: '9mobile',
    };
  }

  return {
    asn,
    asOrganization,
    colo,
    country,
    verifiedNetwork: `${asOrganization || 'Unknown ISP'} (AS${asn || 0})`,
    verifiedCarrierKey: 'Other',
  };
}

export function normalizeSelfReportedCarrier(raw: unknown): string {
  if (typeof raw !== 'string') return 'Unknown';
  const trimmed = raw.trim();
  if (!trimmed) return 'Unknown';
  const lower = trimmed.toLowerCase();
  if (lower === 'mtn') return 'MTN';
  if (lower === 'airtel') return 'Airtel';
  if (lower === 'glo' || lower === 'globacom') return 'Glo';
  if (lower === '9mobile' || lower === 'emts') return '9mobile';
  if (lower === 'wi-fi' || lower === 'wifi') return 'Wi-Fi';
  return trimmed;
}

export function isSelfReportMismatch(
  selfReportedCarrier: string,
  netInfo: VerifiedNetworkInfo
): boolean {
  const normalized = normalizeSelfReportedCarrier(selfReportedCarrier);
  if (netInfo.verifiedCarrierKey !== 'Other') {
    return normalized !== netInfo.verifiedCarrierKey;
  }
  return (
    normalized === 'MTN' ||
    normalized === 'Airtel' ||
    normalized === 'Glo' ||
    normalized === '9mobile'
  );
}
