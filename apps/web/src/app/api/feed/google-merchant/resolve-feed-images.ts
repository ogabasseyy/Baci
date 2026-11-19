import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import {
  resolveGmcAdditionalImages,
  resolveGmcPrimaryImage,
} from '@/lib/gmc-feed-images';
import { escapeXml } from '@/lib/xml-utils';

export interface ResolvedFeedImages {
  additionalImagesXml: string;
  primaryImageUrl: string;
}

function buildAdditionalImagesXml(urls: string[]) {
  return urls
    .map(
      (url) =>
        `        <g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`
    )
    .join('\n');
}

export function resolveFeedImages(
  entries: FeedImageManifestEntry[],
  excludeUrls: ReadonlySet<string> = new Set(),
  renderXml = true
): ResolvedFeedImages | null {
  const primaryImageUrl = resolveGmcPrimaryImage(entries, excludeUrls);

  if (!primaryImageUrl) {
    return null;
  }

  return {
    primaryImageUrl,
    additionalImagesXml: renderXml
      ? buildAdditionalImagesXml(
          resolveGmcAdditionalImages(entries, excludeUrls).filter(
            (url) => url !== primaryImageUrl
          )
        )
      : '',
  };
}
