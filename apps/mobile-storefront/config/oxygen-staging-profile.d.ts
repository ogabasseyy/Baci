export interface OxygenStagingProfile {
  readonly apiOrigin: string;
  readonly authOrigin: string;
  readonly authBaseUrl: string;
  readonly expectedAuthIssuer: string;
  readonly publicKey: string;
  readonly merchantId: string;
  readonly merchantSlug: string;
  readonly storagePrefix: string;
  readonly environment: 'staging';
  readonly appId: 'com.ogabassey.oxygenstaging';
}
export function readOxygenStagingProfile(
  input: unknown,
  development: boolean
): OxygenStagingProfile;
