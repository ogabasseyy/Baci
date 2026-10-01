export interface StorefrontPdpSemanticReadCooldown {
  clear(scope: string): void;
  isCoolingDown(scope: string, now?: number): boolean;
  markFailure(scope: string, now?: number): void;
  reset(): void;
}
