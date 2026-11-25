import { parseExpectSignatureHeader, signRsaSha256Sfv } from './crypto';
import { buildMultipartMixedResponse } from './multipart';
import type {
  ChannelCurrentState,
  ExpoDirective,
  ExpoManifestAsset,
  ExpoUpdateManifest,
  OtaWorkerEnv,
  StoredManifestAsset,
  StoredReleaseRecord,
} from './types';
import {
  errorResponse,
  ValidationError,
  validateChannelName,
  validatePlatform,
  validateRuntimeVersion,
} from './validation';

function resolveAssetForManifest(
  asset: StoredManifestAsset,
  requestUrl: string
): ExpoManifestAsset {
  const url = asset.r2Key
    ? new URL(`/api/assets/${asset.r2Key}`, requestUrl).toString()
    : asset.url;

  if (!url) {
    throw new Error('Asset record has neither r2Key nor url');
  }

  return {
    hash: asset.hash,
    key: asset.key,
    contentType: asset.contentType,
    ...(asset.fileExtension !== undefined
      ? { fileExtension: asset.fileExtension }
      : {}),
    url,
  };
}

function signBodyIfConfigured(
  body: string,
  env: OtaWorkerEnv
): string | undefined {
  const privateKey = env.OTA_SIGNING_PRIVATE_KEY?.trim();
  if (!privateKey) {
    return undefined;
  }
  const keyId = env.OTA_SIGNING_KEY_ID?.trim() || 'main';
  return signRsaSha256Sfv(body, privateKey, keyId);
}

function directiveResponse(
  directive: ExpoDirective,
  env: OtaWorkerEnv
): Response {
  const body = JSON.stringify(directive);
  const signature = signBodyIfConfigured(body, env);
  return buildMultipartMixedResponse([
    {
      name: 'directive',
      body,
      ...(signature ? { signature } : {}),
    },
  ]);
}

export async function handleGetManifest(
  request: Request,
  env: OtaWorkerEnv
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const protocolVersion = request.headers.get('expo-protocol-version');
  if (!protocolVersion) {
    return errorResponse('Missing expo-protocol-version header', 400);
  }
  if (protocolVersion.trim() !== '1') {
    return errorResponse('Unsupported expo-protocol-version (expected 1)', 406);
  }

  let platform: 'ios' | 'android';
  let runtimeVersion: string;
  let channel: string;
  try {
    platform = validatePlatform(request.headers.get('expo-platform'));
    runtimeVersion = validateRuntimeVersion(
      request.headers.get('expo-runtime-version')
    );
    channel = validateChannelName(request.headers.get('expo-channel-name'));
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }

  const expectSig = parseExpectSignatureHeader(
    request.headers.get('expo-expect-signature')
  );
  if (expectSig.error) {
    return errorResponse(expectSig.error, 406);
  }

  const hasSigningKey = Boolean(env.OTA_SIGNING_PRIVATE_KEY?.trim());
  const configuredKeyId = env.OTA_SIGNING_KEY_ID?.trim() || 'main';
  if (expectSig.expected) {
    if (!hasSigningKey) {
      return errorResponse(
        'Manifest signing was requested but signing key is not configured',
        500
      );
    }
    if (expectSig.keyid && expectSig.keyid !== configuredKeyId) {
      return errorResponse(
        `Requested signing keyid "${expectSig.keyid}" does not match configured key`,
        400
      );
    }
  }

  const currentPointerKey = `channels/${channel}/${platform}/${runtimeVersion}/current.json`;
  const pointerObject = await env.OTA_BUCKET.get(currentPointerKey);
  if (!pointerObject) {
    return directiveResponse({ type: 'noUpdateAvailable' }, env);
  }

  const current = await pointerObject.json<ChannelCurrentState>();
  const currentUpdateId = request.headers
    .get('expo-current-update-id')
    ?.trim()
    .toLowerCase();
  const embeddedUpdateId = request.headers
    .get('expo-embedded-update-id')
    ?.trim()
    .toLowerCase();

  if (current.mode === 'rollback_to_embedded') {
    if (!embeddedUpdateId || currentUpdateId === embeddedUpdateId) {
      return directiveResponse({ type: 'noUpdateAvailable' }, env);
    }
    return directiveResponse(
      {
        type: 'rollBackToEmbedded',
        parameters: { commitTime: current.commitTime },
      },
      env
    );
  }

  if (currentUpdateId && currentUpdateId === current.updateId.toLowerCase()) {
    return directiveResponse({ type: 'noUpdateAvailable' }, env);
  }

  const releaseKey = `releases/${channel}/${platform}/${runtimeVersion}/${current.updateId}.json`;
  const releaseObject = await env.OTA_BUCKET.get(releaseKey);
  if (!releaseObject) {
    return errorResponse(
      'Active release manifest is missing from storage',
      500
    );
  }

  const release = await releaseObject.json<StoredReleaseRecord>();
  const manifest: ExpoUpdateManifest = {
    id: release.id,
    createdAt: release.createdAt,
    runtimeVersion: release.runtimeVersion,
    launchAsset: resolveAssetForManifest(release.launchAsset, request.url),
    assets: release.assets.map((asset) =>
      resolveAssetForManifest(asset, request.url)
    ),
    metadata: release.metadata,
    extra: release.extra,
  };

  const manifestJson = JSON.stringify(manifest);
  const signature = signBodyIfConfigured(manifestJson, env);

  return buildMultipartMixedResponse([
    {
      name: 'manifest',
      body: manifestJson,
      ...(signature ? { signature } : {}),
    },
  ]);
}
