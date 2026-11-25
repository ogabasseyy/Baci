export interface R2HttpMetadata {
  contentType?: string;
}

export interface R2ObjectLike {
  key: string;
  size: number;
  etag?: string;
  httpEtag?: string;
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

export interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream<Uint8Array>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface R2ConditionalLike {
  etagMatches?: string;
  etagDoesNotMatch?: string;
}

export interface R2PutOptionsLike {
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
  onlyIf?: R2ConditionalLike;
}

export interface OtaR2Bucket {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream<Uint8Array>,
    options?: R2PutOptionsLike
  ): Promise<R2ObjectLike | null>;
  delete?(key: string): Promise<void>;
}

export interface OtaWorkerEnv {
  OTA_BUCKET: OtaR2Bucket;
  OTA_ADMIN_TOKEN?: string;
  OTA_SIGNING_PRIVATE_KEY?: string;
  OTA_SIGNING_KEY_ID?: string;
}

export type OtaPlatform = 'ios' | 'android';

export interface StoredManifestAsset {
  hash: string;
  key: string;
  contentType: string;
  fileExtension?: string;
  r2Key: string;
}

export interface ExpoManifestAsset {
  hash: string;
  key: string;
  contentType: string;
  fileExtension?: string;
  url: string;
}

export interface StoredReleaseRecord {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  channel: string;
  platform: OtaPlatform;
  sourceSha?: string;
  rollbackOfUpdateId?: string;
  launchAsset: StoredManifestAsset;
  assets: StoredManifestAsset[];
  metadata: Record<string, string>;
  extra: Record<string, unknown>;
}

export interface ExpoUpdateManifest {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ExpoManifestAsset;
  assets: ExpoManifestAsset[];
  metadata: Record<string, string>;
  extra: Record<string, unknown>;
}

export type ExpoDirective =
  | { type: 'noUpdateAvailable' }
  | { type: 'rollBackToEmbedded'; parameters: { commitTime: string } };

export interface RollbackOperationResult {
  ok: true;
  mode: 'update' | 'rollback_to_embedded';
  channel: string;
  platform: OtaPlatform;
  runtimeVersion: string;
  updateId?: string;
  rolledBackToUpdateId?: string;
  commitTime?: string;
  unchanged?: boolean;
}

export interface RollbackHistoryEntry {
  key: string;
  fingerprint?: string;
  response: RollbackOperationResult;
}

export type ChannelCurrentState =
  | {
      mode: 'update';
      updateId: string;
      activeSourceUpdateId?: string;
      previousUpdateId?: string;
      updatedAt: string;
      lastRollback?: RollbackHistoryEntry;
      recentRollbacks?: RollbackHistoryEntry[];
    }
  | {
      mode: 'rollback_to_embedded';
      commitTime: string;
      previousUpdateId?: string;
      updatedAt: string;
      lastRollback?: RollbackHistoryEntry;
      recentRollbacks?: RollbackHistoryEntry[];
    };

export interface PublishPayload {
  channel?: string;
  platform: OtaPlatform;
  runtimeVersion: string;
  updateId?: string;
  createdAt?: string;
  sourceSha?: string;
  launchAsset: StoredManifestAsset;
  assets?: StoredManifestAsset[];
  metadata?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export interface RollbackPayload {
  channel?: string;
  platform: OtaPlatform;
  runtimeVersion: string;
  targetUpdateId?: string;
  toEmbedded?: boolean;
  idempotencyKey?: string;
}
