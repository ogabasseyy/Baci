function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const BASE64_LABEL_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const PDF_DATA_URL_PATTERN =
  /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/i;

/** Convert Jumia print-label payloads (HTTP URL or base64 PDF) into openable URLs. */
export function resolveJumiaLabelUrl(label: string | undefined): string | null {
  if (!label) return null;
  if (isValidHttpUrl(label)) return label;
  // Only accept a PDF data URL. Provider-controlled data URLs are otherwise
  // able to inject arbitrary media into the label viewer.
  if (label.startsWith('data:')) {
    return PDF_DATA_URL_PATTERN.test(label) ? label : null;
  }
  if (!BASE64_LABEL_PATTERN.test(label) || label.length < 4) return null;
  return `data:application/pdf;base64,${label}`;
}
