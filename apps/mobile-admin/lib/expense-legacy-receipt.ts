export function legacyMediaPath(
  merchantId: string,
  legacyUrl: string
): string | null {
  try {
    const url = new URL(legacyUrl);
    if (url.protocol !== 'https:') return null;
    const pathname = decodeURIComponent(url.pathname);
    const marker = '/object/public/media/';
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const objectPath = pathname.slice(markerIndex + marker.length);
    const segments = objectPath.split('/');
    if (segments.length !== 3) return null;
    const [namespace, objectMerchantId, fileName] = segments;
    if (
      namespace !== 'expenses' ||
      objectMerchantId !== merchantId ||
      !fileName ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName)
    ) {
      return null;
    }
    return objectPath;
  } catch {
    return null;
  }
}
