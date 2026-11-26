export interface MultipartPart {
  name: 'manifest' | 'directive' | 'extensions';
  body: string;
  signature?: string;
}

export function acceptsMultipartMixed(acceptHeader: string | null): boolean {
  if (!acceptHeader || acceptHeader.trim().length === 0) {
    return true;
  }
  let bestSpecificity = 0;
  let bestQ = 0;
  for (const rawRange of acceptHeader.split(',')) {
    const [mediaTypePart, ...params] = rawRange.trim().toLowerCase().split(';');
    const mediaType = mediaTypePart?.trim();
    const specificity =
      mediaType === 'multipart/mixed'
        ? 3
        : mediaType === 'multipart/*'
          ? 2
          : mediaType === '*/*'
            ? 1
            : 0;
    if (specificity === 0) {
      continue;
    }
    let q = 1;
    let hasIncompatibleMediaParam = false;
    for (const param of params) {
      const eqIdx = param.indexOf('=');
      if (eqIdx === -1) continue;
      const key = param.slice(0, eqIdx).trim();
      const value = param.slice(eqIdx + 1).trim();
      if (key === 'q') {
        const parsedQ = Number(value);
        if (!Number.isNaN(parsedQ)) {
          q = parsedQ;
        }
      } else {
        // Non-q media parameters (e.g. boundary=...) restrict this range; server generates a fresh boundary.
        hasIncompatibleMediaParam = true;
      }
    }
    if (hasIncompatibleMediaParam) {
      continue;
    }
    if (
      specificity > bestSpecificity ||
      (specificity === bestSpecificity && q > bestQ)
    ) {
      bestSpecificity = specificity;
      bestQ = q;
    }
  }
  return bestSpecificity > 0 && bestQ > 0;
}

export function buildMultipartMixedResponse(parts: MultipartPart[]): Response {
  const boundary = `baci-ota-${crypto.randomUUID().replace(/-/g, '')}`;
  const chunks: string[] = [];

  for (const part of parts) {
    chunks.push(`--${boundary}\r\n`);
    chunks.push(`content-disposition: form-data; name="${part.name}"\r\n`);
    chunks.push('content-type: application/json; charset=utf-8\r\n');
    if (part.signature) {
      chunks.push(`expo-signature: ${part.signature}\r\n`);
    }
    chunks.push('\r\n');
    chunks.push(part.body);
    chunks.push('\r\n');
  }
  chunks.push(`--${boundary}--\r\n`);

  return new Response(chunks.join(''), {
    status: 200,
    headers: {
      'content-type': `multipart/mixed; boundary=${boundary}`,
      'expo-protocol-version': '1',
      'expo-sfv-version': '0',
      'cache-control': 'private, no-store',
      vary: [
        'expo-protocol-version',
        'expo-platform',
        'expo-runtime-version',
        'expo-channel-name',
        'expo-current-update-id',
        'expo-embedded-update-id',
        'expo-expect-signature',
      ].join(', '),
    },
  });
}
