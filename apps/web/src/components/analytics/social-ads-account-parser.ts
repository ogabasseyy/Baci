export interface SocialAdsAccount {
  accountId: string;
  currencyCode: string | null;
  label: string;
  selected: boolean;
  timezoneName: string | null;
}

export function parseSocialAdsAccounts(value: unknown): SocialAdsAccount[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.accountId !== 'string' || typeof row.label !== 'string') {
      return [];
    }
    return [
      {
        accountId: row.accountId,
        currencyCode:
          typeof row.currencyCode === 'string' ? row.currencyCode : null,
        label: row.label,
        selected: row.selected === true,
        timezoneName:
          typeof row.timezoneName === 'string' ? row.timezoneName : null,
      },
    ];
  });
}
