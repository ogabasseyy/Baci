import path from 'node:path';
import { pathToFileURL } from 'node:url';

function extractMultipartJsonBodies(contentType, bodyText) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? '');
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new Error(`Missing multipart boundary in content-type: ${contentType}`);
  }
  const delimiter = `--${boundary}`;
  const rawParts = bodyText.split(delimiter).slice(1);
  const payloads = [];
  for (const part of rawParts) {
    if (part.startsWith('--')) break;
    const trimmed = part.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    const sepIdx = trimmed.indexOf('\r\n\r\n');
    const splitAt = sepIdx >= 0 ? sepIdx : trimmed.indexOf('\n\n');
    const splitLen = sepIdx >= 0 ? 4 : 2;
    if (splitAt < 0) continue;
    const partBody = trimmed.slice(splitAt + splitLen).trim();
    if (partBody) {
      payloads.push(JSON.parse(partBody));
    }
  }
  return payloads;
}

export async function smokeCheckManifestEndpoint(
  {
    manifestUrl,
    platform,
    runtimeVersion,
    channel,
    expectedMode,
    expectedUpdateId,
    expectSignatureKeyId,
  },
  fetchImpl = fetch
) {
  const headers = {
    'expo-protocol-version': '1',
    'expo-platform': platform,
    'expo-runtime-version': runtimeVersion,
    'expo-channel-name': channel,
  };
  if (expectedMode === 'rollback_to_embedded') {
    headers['expo-current-update-id'] = '00000000-0000-4000-8000-000000000001';
    headers['expo-embedded-update-id'] = '00000000-0000-4000-8000-000000000000';
  }
  if (expectSignatureKeyId) {
    headers['expo-expect-signature'] =
      `sig, keyid="${expectSignatureKeyId}", alg="rsa-v1_5-sha256"`;
  }

  const resp = await fetchImpl(manifestUrl, {
    method: 'GET',
    headers,
    redirect: 'error',
  });
  const text = await resp.text();
  if (resp.status !== 200) {
    throw new Error(`Manifest smoke check failed (${resp.status}): ${text}`);
  }
  const contentType = resp.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/mixed')) {
    throw new Error(`Expected multipart/mixed content-type, got: ${contentType}`);
  }

  const payloads = extractMultipartJsonBodies(contentType, text);
  const first = payloads[0];
  if (!first || typeof first !== 'object') {
    throw new Error('Manifest smoke check returned no JSON payload part');
  }

  if (expectedMode === 'rollback_to_embedded') {
    if (first.type !== 'rollBackToEmbedded') {
      throw new Error(`Expected rollBackToEmbedded directive, got: ${JSON.stringify(first)}`);
    }
    return first;
  }

  if (!expectedUpdateId || first.id !== expectedUpdateId) {
    throw new Error(
      `Expected active manifest id ${expectedUpdateId}, got: ${JSON.stringify(first)}`
    );
  }
  return first;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const manifestUrl = process.env.OTA_MANIFEST_URL;
  const platform = process.env.PLATFORM;
  const runtimeVersion = process.env.RUNTIME_VERSION;
  const channel = process.env.CHANNEL;
  const resultJson = process.env.OTA_OPERATION_RESULT;
  const expectSignatureKeyId = process.env.OTA_SIGNING_KEY_ID || undefined;
  if (!manifestUrl || !platform || !runtimeVersion || !channel || !resultJson) {
    throw new Error('Missing required env vars for OTA manifest smoke check');
  }
  const opResult = JSON.parse(resultJson);
  const expectedMode =
    opResult.mode === 'rollback_to_embedded' ? 'rollback_to_embedded' : 'update';
  await smokeCheckManifestEndpoint({
    manifestUrl,
    platform,
    runtimeVersion,
    channel,
    expectedMode,
    expectedUpdateId: opResult.updateId,
    expectSignatureKeyId,
  });
  console.log(
    `Manifest smoke check passed (${expectedMode}${opResult.updateId ? ` ${opResult.updateId}` : ''}).`
  );
}
