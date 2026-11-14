import type { JsonLdStructuredData } from '@/lib/json-ld-types';
import { stripHtmlTags } from './sanitize-core';
import { sanitizeSchemaUrl } from './sanitize-json-ld';

const YOUTUBE_URL_REGEX =
  /https?:\/\/(?:(?:[A-Za-z0-9-]+\.)?youtube(?:-nocookie)?\.com|youtu\.be)\/[^\s"'<>)]*/gi;
const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const MAX_VIDEO_URLS = 20;
const MAX_TEXT_LENGTH = 500;

type BlogVideoMetadata = {
  schema: JsonLdStructuredData | null;
  video: {
    thumbnailUrl: string;
    title: string;
    videoId: string;
    watchUrl: string;
  };
};

function normalizeText(value: string | null | undefined, fallback: string) {
  const normalized = stripHtmlTags(value ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const text = normalized || fallback.trim();
  return text.length > MAX_TEXT_LENGTH
    ? `${text.slice(0, MAX_TEXT_LENGTH - 1).trimEnd()}…`
    : text;
}

function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function collectYouTubeUrls(
  value: unknown,
  output: string[],
  depth = 0
): string[] {
  if (output.length >= MAX_VIDEO_URLS || depth > 12) {
    return output;
  }

  if (typeof value === 'string') {
    const normalizedValue = value.replace(/&amp;/g, '&');
    for (const match of normalizedValue.matchAll(YOUTUBE_URL_REGEX)) {
      output.push(match[0].replace(/[.,;:!?]+$/, ''));
      if (output.length >= MAX_VIDEO_URLS) {
        break;
      }
    }
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectYouTubeUrls(item, output, depth + 1);
      if (output.length >= MAX_VIDEO_URLS) {
        break;
      }
    }
    return output;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectYouTubeUrls(item, output, depth + 1);
      if (output.length >= MAX_VIDEO_URLS) {
        break;
      }
    }
  }

  return output;
}

function extractYouTubeUrls(content: unknown): string[] {
  return collectYouTubeUrls(content, []);
}

function getPathVideoId(url: URL, index: number): string | null {
  const segment = url.pathname.split('/').filter(Boolean)[index];
  return segment && YOUTUBE_ID_REGEX.test(segment) ? segment : null;
}

function extractYouTubeVideoId(urlValue: string): string | null {
  const safeUrl = sanitizeSchemaUrl(urlValue);
  if (!safeUrl) {
    return null;
  }

  try {
    const url = new URL(safeUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');

    if (host === 'youtu.be') {
      return getPathVideoId(url, 0);
    }

    const isYouTubeHost =
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtube-nocookie.com' ||
      host.endsWith('.youtube-nocookie.com');

    if (!isYouTubeHost) {
      return null;
    }

    const watchId = url.searchParams.get('v');
    if (watchId && YOUTUBE_ID_REGEX.test(watchId)) {
      return watchId;
    }

    const pathParts = url.pathname.split('/').filter(Boolean);
    if (
      ['embed', 'shorts', 'live'].includes(pathParts[0] ?? '') &&
      pathParts[1] &&
      YOUTUBE_ID_REGEX.test(pathParts[1])
    ) {
      return pathParts[1];
    }
  } catch {
    return null;
  }

  return null;
}

function findFirstYouTubeVideoId(content: unknown): string | null {
  for (const url of extractYouTubeUrls(content)) {
    const videoId = extractYouTubeVideoId(url);
    if (videoId) {
      return videoId;
    }
  }
  return null;
}

export function buildBlogVideoMetadata(input: {
  authorName?: string | null;
  authorType?: 'Person' | 'Organization';
  content: unknown;
  description?: string | null;
  postUrl: string;
  publisherName?: string | null;
  title: string;
  videoUploadDate?: string | null;
}): BlogVideoMetadata | null {
  const videoId = findFirstYouTubeVideoId(input.content);
  const postUrl = sanitizeSchemaUrl(input.postUrl);

  if (!videoId || !postUrl) {
    return null;
  }

  const title = normalizeText(input.title, 'Article video');
  const description = normalizeText(input.description, title);
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const uploadDate = normalizeIsoDate(input.videoUploadDate ?? null);
  const authorName = normalizeText(input.authorName, '');
  const publisherName = normalizeText(input.publisherName, '');
  const schema: JsonLdStructuredData | null = uploadDate
    ? {
        '@context': 'https://schema.org',
        '@id': `${postUrl}#video-${videoId}`,
        '@type': 'VideoObject',
        description,
        embedUrl,
        isAccessibleForFree: true,
        mainEntityOfPage: {
          '@id': postUrl,
          '@type': 'WebPage',
        },
        name: title,
        thumbnailUrl: [thumbnailUrl],
        uploadDate,
        url: watchUrl,
        ...(authorName && {
          author: {
            '@type': input.authorType ?? 'Person',
            name: authorName,
          },
        }),
        ...(publisherName && {
          publisher: {
            '@type': 'Organization',
            name: publisherName,
          },
        }),
      }
    : null;

  return {
    schema,
    video: {
      thumbnailUrl,
      title,
      videoId,
      watchUrl,
    },
  };
}
