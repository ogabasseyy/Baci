export interface MultipartPart {
  name: 'manifest' | 'directive' | 'extensions';
  body: string;
  signature?: string;
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
