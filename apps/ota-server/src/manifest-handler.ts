import { parseExpectSignatureHeader, signRsaSha256Sfv } from './crypto';
import { buildMultipartMixedResponse } from './multipart';
import { parseStoredPointer, parseStoredRelease } from './stored-record-parser';
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
  return {
    hash: asset.hash,
    key: asset.key,
    contentType: asset.contentType,
    ...(asset.fileExtension !== undefined
      ? { fileExtension: asset.fileExtension }
      : {}),
    url: new URL(`/api/assets/${asset.r2Key}`, requestUrl).toString(),
  };
}

function signBodyOrError(
  body: string,
  env: OtaWorkerEnv,
  shouldSign: boolean
): { signature?: string; error?: Response } {
  if (!shouldSign) {
    return {};
  }
  const privateKey = env.OTA_SIGNING_PRIVATE_KEY?.trim();
  if (!privateKey) {
    return {};
  }
  const keyId = env.OTA_SIGNING_KEY_ID?.trim() || 'main';
  try {
    return { signature: signRsaSha256Sfv(body, privateKey, keyId) };
  } catch {
    return {
      error: errorResponse('Configured manifest signing key is invalid', 500),
    };
  }
}

function directiveResponse(
  directive: ExpoDirective,
  env: OtaWorkerEnv,
  shouldSign: boolean
): Response {
  const body = JSON.stringify(directive);
  const { signature, error } = signBodyOrError(body, env, shouldSign);
  if (error) {
    return error;
  }
  return buildMultipartMixedResponse([
    {
      name: 'directive',
      body,
      ...(signature ? { signature } : {}),
    },
  ]);
}

function acceptsMultipartMixed(acceptHeader: string | null): boolean {
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
    for (const param of params) {
      const [key, value] = param.trim().split('=');
      if (key?.trim() === 'q' && value !== undefined) {
        const parsedQ = Number(value.trim());
        if (!Number.isNaN(parsedQ)) {
          q = parsedQ;
        }
      }
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

export async function handleGetManifest(
  request: Request,
  env: OtaWorkerEnv
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  if (!acceptsMultipartMixed(request.headers.get('accept'))) {
    return errorResponse(
      'Not Acceptable: multipart/mixed response required',
      406
    );
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
    return directiveResponse(
      { type: 'noUpdateAvailable' },
      env,
      expectSig.expected
    );
  }

  let current: ChannelCurrentState | null = null;
  try {
    current = parseStoredPointer(await pointerObject.json<unknown>());
  } catch {
    return errorResponse('Corrupt release pointer in storage', 500);
  }
  if (!current) {
    return errorResponse('Corrupt release pointer in storage', 500);
  }

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
      return directiveResponse(
        { type: 'noUpdateAvailable' },
        env,
        expectSig.expected
      );
    }
    return directiveResponse(
      {
        type: 'rollBackToEmbedded',
        parameters: { commitTime: current.commitTime },
      },
      env,
      expectSig.expected
    );
  }

  if (currentUpdateId && currentUpdateId === current.updateId.toLowerCase()) {
    return directiveResponse(
      { type: 'noUpdateAvailable' },
      env,
      expectSig.expected
    );
  }

  const releaseKey = `releases/${channel}/${platform}/${runtimeVersion}/${current.updateId}.json`;
  const releaseObject = await env.OTA_BUCKET.get(releaseKey);
  if (!releaseObject) {
    return errorResponse(
      'Active release manifest is missing from storage',
      500
    );
  }

  let release: StoredReleaseRecord | null = null;
  try {
    release = parseStoredRelease(await releaseObject.json<unknown>());
  } catch {
    return errorResponse('Corrupt release manifest in storage', 500);
  }
  if (!release) {
    return errorResponse('Corrupt release manifest in storage', 500);
  }

  if (
    release.id !== current.updateId ||
    release.channel !== channel ||
    release.platform !== platform ||
    release.runtimeVersion !== runtimeVersion
  ) {
    return errorResponse('Corrupt release manifest in storage', 500);
  }

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
  const { signature, error } = signBodyOrError(
    manifestJson,
    env,
    expectSig.expected
  );
  if (error) {
    return error;
  }

  return buildMultipartMixedResponse([
    {
      name: 'manifest',
      body: manifestJson,
      ...(signature ? { signature } : {}),
    },
  ]);
}
