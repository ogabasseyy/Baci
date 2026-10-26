import type { ReactNode } from 'react';
import {
  builderPublicContentDigestSchema,
  builderPublicHomeSchema,
} from '@/schemas/builder-public-home';
/** These two values must derive from the same render snapshot, never separate reads. */
export function PublicationRevisionMarker({
  version,
  contentDigest,
  children,
}: {
  version?: string | null;
  contentDigest: string;
  children: ReactNode;
}) {
  const valid =
    builderPublicHomeSchema.shape.publishedVersion.safeParse(version).success &&
    builderPublicContentDigestSchema.safeParse(contentDigest).success;
  return (
    <div
      data-published-version={contentDigest}
      data-baci-published-version={valid ? version : undefined}
      data-baci-content-digest={valid ? contentDigest : undefined}
    >
      {children}
    </div>
  );
}
