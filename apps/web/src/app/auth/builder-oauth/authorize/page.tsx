import { Suspense } from 'react';
import {
  BuilderOAuthConsent,
  type BuilderOAuthConsentProps,
} from './builder-oauth-consent';

export const metadata = {
  title: 'Connect Baci Website Builder',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
} as const;

export default function BuilderOAuthAuthorization(
  props: BuilderOAuthConsentProps
) {
  return (
    <Suspense fallback={null}>
      <BuilderOAuthConsent {...props} />
    </Suspense>
  );
}
