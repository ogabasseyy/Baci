import type { EXPERIENCE_METHOD_CAPABILITY } from './limits';
export type Digest = string;
export type ExperienceMethod = keyof typeof EXPERIENCE_METHOD_CAPABILITY;
export type ExperienceCapability =
  (typeof EXPERIENCE_METHOD_CAPABILITY)[ExperienceMethod];
export interface ExperienceManifest {
  format: 'baci.experience/v2';
  runtime: 'react-browser-sandbox/v1';
  sdkVersion: 'commerce-bridge/v1';
  entry: string;
  files: Array<{ path: string; content: string }>;
  packages: Array<{ name: string; versionRef: 'platform-pinned' }>;
  routes: Array<{
    path: string;
    view: 'home' | 'collection' | 'product' | 'editorial';
  }>;
  assets: Array<{ assetId: string; alt: string }>;
  capabilities: ExperienceCapability[];
}
export interface RouteState {
  epoch: number;
  routeId: string;
  params: Record<string, string>;
  canonicalPath: string;
  publicDataRevision: string;
}
export interface PublicProduct {
  canonicalPath?: string;
  available?: boolean;
  requiresVariant?: boolean;
  id: string;
  slug: string;
  name: string;
  price: number;
  currency: string;
  image: { assetId: string; alt: string } | null;
  variants: Array<{
    id: string;
    label: string;
    available: boolean;
    price?: number;
  }>;
}
export interface PublicCatalog {
  products: PublicProduct[];
  revision: string;
}
export interface PublicBootstrap {
  currency?: string;
  /** Server-selected design media only; never private reference screenshots. */
  assets?: Record<string, string>;
  route: RouteState;
  catalog: PublicCatalog;
  capabilities: ExperienceCapability[];
}
export interface PublicCartLine {
  lineId: string;
  productId: string;
  variantId?: string;
  quantity: number;
  price: number;
}
export interface PublicCart {
  lines: PublicCartLine[];
  total: number;
  currency: string;
  version: number;
}
export type PublicCartCommand =
  | {
      kind: 'add';
      productId: string;
      variantId?: string;
      condition?: string;
      options?: Record<string, string>;
      quantity: number;
    }
  | { kind: 'remove'; lineId: string }
  | { kind: 'set_quantity'; lineId: string; quantity: number };
export type ExperienceErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'CONNECTION_REVOKED'
  | 'INSUFFICIENT_SCOPE'
  | 'STALE_DRAFT'
  | 'STALE_ROUTE'
  | 'ROUTE_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'UNSUPPORTED_PACKAGE'
  | 'UNSUPPORTED_BROWSER_API'
  | 'BUILD_FAILED'
  | 'LAUNCH_EXPIRED'
  | 'SNAPSHOT_STALE'
  | 'CART_ENROLLMENT_REQUIRED'
  | 'ACCOUNT_CART_REQUIRES_TRUSTED_FLOW';
export type BridgeResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; code: ExperienceErrorCode; message: string };
export type CartBridgeResult =
  | BridgeResult<PublicCart>
  | { status: 'conflict'; currentVersion: number }
  | { status: 'indeterminate'; operationId: string };
export interface SharedCartCommandPort {
  submit(
    command: PublicCartCommand,
    requestId: string
  ): Promise<CartBridgeResult>;
  reconcile(operationId: string): Promise<CartBridgeResult>;
}
/** Host-only correlation; never serialized into authored code. */
export interface PortBinding {
  instanceId: string;
  buildDigest: Digest;
  shopperPartition: string;
}
export interface PendingOperation {
  command: PublicCartCommand;
  expectedVersion: number;
  operationId: string;
  payloadHash: Digest;
  shopperPartition: string;
  dispatchState:
    | 'queued'
    | 'preparing'
    | 'wire-attempted'
    | 'confirmed'
    | 'indeterminate'
    | 'cancelled-unsent';
}
export interface ExperienceCommerce {
  catalog: {
    collection(handle: string): Promise<BridgeResult<PublicCatalog>>;
    product(handle: string): Promise<BridgeResult<PublicProduct>>;
    variants(
      productId: string
    ): Promise<BridgeResult<PublicProduct['variants']>>;
  };
  cart: {
    readPublic(): Promise<BridgeResult<PublicCart>>;
    reconcile(operationId: string): Promise<CartBridgeResult>;
    add(
      input: Omit<Extract<PublicCartCommand, { kind: 'add' }>, 'kind'>
    ): Promise<CartBridgeResult>;
    remove(lineId: string): Promise<CartBridgeResult>;
    setQuantity(lineId: string, quantity: number): Promise<CartBridgeResult>;
  };
  checkout: {
    prepare(): Promise<BridgeResult<{ ready: boolean }>>;
    open(): Promise<BridgeResult<{ presented: boolean }>>;
  };
  navigation: {
    go(path: string): Promise<BridgeResult<RouteState>>;
    open(path: string): Promise<BridgeResult<{ presented: boolean }>>;
  };
}
export interface BridgeRequest {
  protocol: 'baci-commerce/1';
  instanceId: string;
  buildDigest: Digest;
  routeEpoch: number;
  requestId: string;
  capability: ExperienceCapability;
  method: ExperienceMethod;
  args: Record<string, unknown>;
}
export interface EvidenceDescriptor {
  evidenceId: string;
  buildDigest: Digest;
  captureId: string;
  mime: 'image/png' | 'image/jpeg';
  bytes: number;
  ready: boolean;
}
export interface BuildOutput {
  sourceDigest: Digest;
  buildDigest: Digest;
  toolchainDigest: Digest;
  files: Array<{ path: string; digest: Digest; bytes: number }>;
  importGraph: Record<string, string[]>;
  diagnostics: Array<{ code: string; message: string }>;
  usage: { wallMs: number; peakMemoryBytes: number };
}

/** Trusted supervisor only. Never serialized into authored code or SDK bootstrap. */
export interface JobTicket {
  jobId: string;
  sourceDigest: Digest;
  attemptNonce: string;
  audience: 'experience-output';
  toolchainDigest: Digest;
  expiresAt: number;
  maxBytes: number;
}
export interface VerifiedRuntimeFile {
  path: string;
  mime: string;
  digest: Digest;
  bytes: Uint8Array;
}
export interface TransientOutputStore {
  put(value: unknown, now: number): string;
  read(id: string, now: number): unknown;
  remove(id: string): void;
  sweep(now: number): void;
}
/** Private staging is implemented before anonymous current-publication delivery. */
export interface PublishedOutputStore<Context, AcceptedOutput> {
  stageVerifiedBuild(
    ctx: Context,
    input: { jobId: string; idempotencyKey: string },
    accepted: AcceptedOutput
  ): Promise<{ buildId: string; buildDigest: Digest }>;
  readCurrentPublishedFile(
    merchantId: string,
    buildDigest: Digest,
    path: string
  ): Promise<VerifiedRuntimeFile | null>;
  retainReferencedBuild(ctx: Context, buildId: string): Promise<void>;
}
export interface PublishedLaunchRef {
  kind: 'published';
  instanceId: string;
  buildDigest: Digest;
  canonicalRoute: string;
  runtimeBase: string;
  expiresAt: number;
}
export type RuntimeMode =
  | {
      kind: 'private-preview';
      bindingId: string;
      expiresAt: number;
      commerce: ExperienceCommerce;
    }
  | {
      kind: 'published';
      launch: PublishedLaunchRef;
      commerce: ExperienceCommerce;
    };
export interface EffectiveCapabilities {
  capabilities: ExperienceCapability[];
  revision: string;
}
