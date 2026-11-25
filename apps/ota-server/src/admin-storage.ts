import { sha256Base64Url } from './crypto';
import type {
  ChannelCurrentState,
  OtaWorkerEnv,
  StoredManifestAsset,
} from './types';
import { errorResponse } from './validation';

const MAX_POINTER_RETRIES = 5;

export async function verifyAssetIntegrity(
  env: OtaWorkerEnv,
  asset: StoredManifestAsset
): Promise<string | null> {
  if (!asset.r2Key) {
    return null;
  }
  const storageKey = `assets/${asset.r2Key}`;
  const head = await env.OTA_BUCKET.head(storageKey);
  if (!head) {
    return `Referenced asset does not exist in R2: ${asset.r2Key}`;
  }

  const metadataHash = head.customMetadata?.sha256Base64Url;
  if (metadataHash !== undefined) {
    return metadataHash === asset.hash
      ? null
      : `Stored asset hash mismatch in R2: ${asset.r2Key}`;
  }

  const obj = await env.OTA_BUCKET.get(storageKey);
  if (!obj) {
    return `Referenced asset does not exist in R2: ${asset.r2Key}`;
  }
  const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
  const computedHash = sha256Base64Url(bytes);
  return computedHash === asset.hash
    ? null
    : `Stored asset hash mismatch in R2: ${asset.r2Key}`;
}

export async function updateChannelPointerCas(
  env: OtaWorkerEnv,
  pointerKey: string,
  buildNextState: (
    existing: ChannelCurrentState | null
  ) => ChannelCurrentState | Response
): Promise<ChannelCurrentState | Response> {
  for (let attempt = 0; attempt < MAX_POINTER_RETRIES; attempt += 1) {
    const existingObj = await env.OTA_BUCKET.get(pointerKey);
    const existingState = existingObj
      ? await existingObj.json<ChannelCurrentState>()
      : null;
    const nextOrError = buildNextState(existingState);
    if (nextOrError instanceof Response) {
      return nextOrError;
    }

    const written = await env.OTA_BUCKET.put(
      pointerKey,
      JSON.stringify(nextOrError),
      {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
        onlyIf: existingObj?.httpEtag
          ? { etagMatches: existingObj.httpEtag }
          : { etagDoesNotMatch: '*' },
      }
    );
    if (written) {
      return nextOrError;
    }
  }
  return errorResponse(
    'Concurrent channel pointer update conflict; retry',
    409
  );
}
