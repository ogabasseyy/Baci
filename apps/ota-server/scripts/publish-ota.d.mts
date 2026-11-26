import type { OtaPlatform, PublishPayload } from '../src/types';

export type OtaFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface PublishCliOptions {
  channel: string;
  dryRun: boolean;
  rollback: boolean;
  toEmbedded: boolean;
  serverUrl: string;
  token: string;
  distDir?: string;
  configPath?: string;
  platform?: OtaPlatform;
  runtimeVersion?: string;
  sourceSha?: string;
  updateId?: string;
  expectedCurrentUpdateId?: string;
  idempotencyKey?: string;
}

export interface PackagedAssetUpload {
  r2Key: string;
  bytes: Uint8Array;
  contentType: string;
  sha256Hex: string;
}

export function inferAssetContentType(ext: string): string;
export function parseCliArgs(argv: string[]): PublishCliOptions;
export function packageExportDirectory(params: {
  distDir: string;
  platform: OtaPlatform;
  runtimeVersion: string;
  channel?: string;
  configPath?: string;
  sourceSha?: string;
  updateId?: string;
}): Promise<{
  payload: PublishPayload & {
    assets: NonNullable<PublishPayload['assets']>;
    extra: Record<string, unknown>;
  };
  uploads: PackagedAssetUpload[];
}>;
export function publishOta(
  options: {
    distDir: string;
    configPath?: string;
    platform: OtaPlatform;
    runtimeVersion: string;
    channel?: string;
    sourceSha?: string;
    updateId?: string;
    serverUrl: string;
    token: string;
    dryRun?: boolean;
  },
  fetchImpl?: OtaFetch
): Promise<Record<string, unknown>>;
export function rollbackOta(
  options: {
    platform: OtaPlatform;
    runtimeVersion: string;
    channel?: string;
    toEmbedded?: boolean;
    updateId?: string;
    expectedCurrentUpdateId?: string;
    idempotencyKey?: string;
    serverUrl: string;
    token: string;
    dryRun?: boolean;
  },
  fetchImpl?: OtaFetch
): Promise<Record<string, unknown>>;
