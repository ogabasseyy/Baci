import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
export interface ExperienceFrameLaunch {
  src: string;
  buildDigest: string;
  instanceId: string;
  nonce: string;
  expiresAt: number;
  bootstrap: PublicBootstrap;
  routes: ExperienceManifest['routes'];
  canonicalBase: string;
}

export interface PublishedExperienceFrameHost {
  failed?: () => void;
  ready?: () => void;
  current(): {
    bootstrap?: import('@baci/shared/experience').PublicBootstrap;
    route: import('@baci/shared/experience').RouteState;
    binding: import('@baci/shared/experience').PortBinding;
    revision: string;
    generation: number;
    active: boolean;
    transition: boolean;
  };
  dispatch(
    request: import('@baci/shared/experience').BridgeRequest
  ): Promise<
    | import('@baci/shared/experience').BridgeResult<unknown>
    | import('@baci/shared/experience').CartBridgeResult
  >;
  resolveNavigation(path: string): Promise<string>;
  navigate(path: string): Promise<import('@baci/shared/experience').RouteState>;
  subscribe(
    listener: (route: import('@baci/shared/experience').RouteState) => void
  ): () => void;
}

export interface ExperienceFrameProps {
  launch: ExperienceFrameLaunch;
  isActive: () => Promise<boolean>;
  host?: PublishedExperienceFrameHost;
  /** A published host stays inert until the parent runtime admits its binding. */
  admitted?: boolean;
  /** A published host stays hidden until the parent has hidden semantic fallback. */
  presented?: boolean;
}
