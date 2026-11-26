import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseSfvDictionaryStrings(rawHeader) {
  const entries = new Map();
  const memberRegex = /([a-z0-9_*-]+)="((?:[^"\\]|\\.)*)"/gi;
  let match = memberRegex.exec(rawHeader);
  while (match !== null) {
    const key = match[1].toLowerCase();
    const val = match[2].replace(/\\(.)/g, '$1');
    entries.set(key, val);
    match = memberRegex.exec(rawHeader);
  }
  return entries;
}

function extractMultipartParts(contentType, bodyText) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? '');
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new Error(`Missing multipart boundary in content-type: ${contentType}`);
  }
  const delimiter = `--${boundary}`;
  const rawParts = bodyText.split(delimiter).slice(1);
  const parts = [];
  for (const part of rawParts) {
    if (part.startsWith('--')) break;
    const trimmed = part.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    const sepIdx = trimmed.indexOf('\r\n\r\n');
    const splitAt = sepIdx >= 0 ? sepIdx : trimmed.indexOf('\n\n');
    const splitLen = sepIdx >= 0 ? 4 : 2;
    if (splitAt < 0) continue;
    const headerBlock = trimmed.slice(0, splitAt);
    const headers = {};
    for (const line of headerBlock.split(/\r?\n/)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx <= 0) continue;
      const name = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();
      headers[name] = value;
    }
    const rawBody = trimmed.slice(splitAt + splitLen);
    if (rawBody.trim()) {
      parts.push({
        headers,
        rawBody,
        payload: JSON.parse(rawBody.trim()),
      });
    }
  }
  return parts;
}

function verifyPartSignature(part, expectSignatureKeyId, publicKeyOrCertPem) {
  if (!publicKeyOrCertPem) {
    throw new Error(
      `Manifest signing is expected (keyid="${expectSignatureKeyId}") but publicKeyOrCertPem / OTA_CODE_SIGNING_CERTIFICATE_PATH is missing`
    );
  }
  const signatureHeader = part.headers['expo-signature'];
  if (!signatureHeader) {
    throw new Error(
      `Expected expo-signature header for keyid "${expectSignatureKeyId}", but none was returned`
    );
  }
  const fields = parseSfvDictionaryStrings(signatureHeader);
  const sig = fields.get('sig');
  const keyid = fields.get('keyid');
  const alg = fields.get('alg');
  if (!sig || !/^[A-Za-z0-9+/=]+$/.test(sig)) {
    throw new Error(`Malformed sig in expo-signature header: ${signatureHeader}`);
  }
  if (keyid !== expectSignatureKeyId) {
    throw new Error(
      `Expected expo-signature keyid "${expectSignatureKeyId}", got "${keyid ?? ''}"`
    );
  }
  if (alg && alg !== 'rsa-v1_5-sha256') {
    throw new Error(`Unsupported expo-signature alg "${alg}"`);
  }
  const key = createPublicKey(publicKeyOrCertPem);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(part.rawBody, 'utf8');
  if (!verifier.verify(key, Buffer.from(sig, 'base64'))) {
    throw new Error('Cryptographic verification failed for expo-signature');
  }
}

async function verifyManifestAssets(manifest, fetchImpl) {
  const launchAsset = manifest.launchAsset;
  if (
    !launchAsset ||
    typeof launchAsset !== 'object' ||
    typeof launchAsset.url !== 'string' ||
    typeof launchAsset.hash !== 'string'
  ) {
    throw new Error(
      `Manifest missing launchAsset.url or launchAsset.hash: ${JSON.stringify(manifest)}`
    );
  }
  const launchResp = await fetchImpl(launchAsset.url, {
    method: 'GET',
    redirect: 'error',
  });
  if (launchResp.status !== 200) {
    throw new Error(
      `Launch asset smoke fetch failed (${launchResp.status}) for ${launchAsset.url}`
    );
  }
  const actualLaunchType = (launchResp.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const expectedLaunchType = (launchAsset.contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (expectedLaunchType && actualLaunchType !== expectedLaunchType) {
    throw new Error(
      `Launch asset content-type mismatch for ${launchAsset.url}: expected "${expectedLaunchType}", got "${actualLaunchType}"`
    );
  }
  const launchBytes = new Uint8Array(await launchResp.arrayBuffer());
  const actualLaunchHash = createHash('sha256')
    .update(launchBytes)
    .digest('base64url');
  if (actualLaunchHash !== launchAsset.hash) {
    throw new Error(
      `Launch asset SHA-256 mismatch for ${launchAsset.url}: expected "${launchAsset.hash}", got "${actualLaunchHash}"`
    );
  }
  for (const asset of manifest.assets ?? []) {
    if (!asset || typeof asset !== 'object' || typeof asset.url !== 'string') {
      throw new Error(
        `Manifest contains invalid asset entry: ${JSON.stringify(asset)}`
      );
    }
    const assetResp = await fetchImpl(asset.url, {
      method: 'HEAD',
      redirect: 'error',
    });
    if (assetResp.status !== 200) {
      throw new Error(
        `Asset smoke HEAD failed (${assetResp.status}) for ${asset.url}`
      );
    }
    const actualAssetType = (assetResp.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const expectedAssetType = (asset.contentType ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (expectedAssetType && actualAssetType !== expectedAssetType) {
      throw new Error(
        `Asset content-type mismatch for ${asset.url}: expected "${expectedAssetType}", got "${actualAssetType}"`
      );
    }
  }
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
    publicKeyOrCertPem,
  },
  fetchImpl = fetch
) {
  const normalizedKeyId = expectSignatureKeyId?.trim() || undefined;
  const normalizedPem = publicKeyOrCertPem?.trim() || undefined;
  if (normalizedPem && !normalizedKeyId) {
    throw new Error(
      'publicKeyOrCertPem was provided without expectSignatureKeyId / OTA_SIGNING_KEY_ID'
    );
  }
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
  if (normalizedKeyId) {
    headers['expo-expect-signature'] =
      `sig, keyid="${normalizedKeyId}", alg="rsa-v1_5-sha256"`;
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

  const parts = extractMultipartParts(contentType, text);
  if (parts.length !== 1) {
    throw new Error(
      `Expected exactly 1 manifest/directive multipart part, got ${parts.length}`
    );
  }
  const firstPart = parts[0];
  const partContentType = firstPart?.headers['content-type'] ?? '';
  if (!partContentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `Expected application/json part content-type, got: ${partContentType}`
    );
  }
  const expectedDispositionName =
    expectedMode === 'rollback_to_embedded' ? 'directive' : 'manifest';
  const partDisposition = firstPart?.headers['content-disposition'] ?? '';
  const nameMatch = /(?:^|;)\s*name=(?:"([^"]+)"|([^;\s]+))/i.exec(
    partDisposition
  );
  const actualDispositionName = (nameMatch?.[1] ?? nameMatch?.[2] ?? '').trim();
  if (actualDispositionName !== expectedDispositionName) {
    throw new Error(
      `Expected multipart content-disposition name="${expectedDispositionName}", got: ${partDisposition || 'missing'}`
    );
  }
  const first = firstPart?.payload;
  if (!firstPart || !first || typeof first !== 'object') {
    throw new Error('Manifest smoke check returned no JSON payload part');
  }

  if (normalizedKeyId) {
    verifyPartSignature(firstPart, normalizedKeyId, normalizedPem);
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
  await verifyManifestAssets(first, fetchImpl);
  return first;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const manifestUrl = process.env.OTA_MANIFEST_URL;
  const platform = process.env.PLATFORM;
  const runtimeVersion = process.env.RUNTIME_VERSION;
  const channel = process.env.CHANNEL;
  const resultJson = process.env.OTA_OPERATION_RESULT;
  const expectSignatureKeyId = process.env.OTA_SIGNING_KEY_ID?.trim() || undefined;
  const certPemEnv = process.env.OTA_CODE_SIGNING_CERTIFICATE_PEM?.trim();
  const certPath = process.env.OTA_CODE_SIGNING_CERTIFICATE_PATH?.trim();
  const publicKeyOrCertPem =
    certPemEnv || (certPath ? readFileSync(certPath, 'utf8') : undefined);
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
    publicKeyOrCertPem,
  });
  console.log(
    `Manifest smoke check passed (${expectedMode}${opResult.updateId ? ` ${opResult.updateId}` : ''}).`
  );
}
