export const residentialKeys = [
  'state',
  'lga',
  'city',
  'street',
  'landmark',
  'house_number',
] as const;
export type ResidentialAddress = Record<
  (typeof residentialKeys)[number],
  string
>;
export type ResidentialProof = { address: ResidentialAddress; file: File };
export function residentialAddress(
  values: Record<string, string> = {}
): ResidentialAddress {
  return Object.fromEntries(
    residentialKeys.map((key) => [key, values[key] ?? ''])
  ) as ResidentialAddress;
}
export function residentialFileError(file: File): string {
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))
    return 'Choose a PDF, JPG or PNG.';
  if (!file.size || file.size > 1_500_000)
    return 'Choose a document smaller than 1.5 MB.';
  return '';
}
