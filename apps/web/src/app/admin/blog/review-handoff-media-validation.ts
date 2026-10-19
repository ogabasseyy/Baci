import { decodeHTMLAttribute } from 'entities';
import { isHttpsUrl } from '@/lib/is-https-url';
import { groupMediaElements } from './review-handoff-media-groups';
import { splitSrcsetCandidates } from './review-handoff-srcset';
import { tagAttributes } from './review-handoff-tag-attributes';

// Lowercase only: like the sanitizer (and browsers), uppercase descriptors
// do not parse as width/density values. Density fractions accept a
// leading dot per the HTML floating-point grammar; a trailing dot stays
// invalid because the sanitizer strips it as an invalid descriptor.
const SRCSET_DESCRIPTOR_PATTERN =
  /^(\d+w|(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?x)$/;

function isValidSrcsetDescriptor(candidate: string): boolean {
  const parts = candidate.trim().split(/\s+/);
  // Descriptorless candidates default to 1x; more than one descriptor is
  // never valid, and a zero value selects no resource.
  if (parts.length <= 1) return true;
  if (parts.length > 2) return false;
  const descriptor = parts[1];
  // The HTML Standard excludes infinity from valid floating-point numbers,
  // so an overflowing density (parseFloat -> Infinity) is invalid even
  // though it matches the pattern and compares greater than zero.
  const density = Number.parseFloat(descriptor);
  return (
    SRCSET_DESCRIPTOR_PATTERN.test(descriptor) &&
    Number.isFinite(density) &&
    density > 0
  );
}

type MediaCandidate = { url: string; valid: boolean };

function mediaTagCandidates(tag: string): MediaCandidate[] {
  const candidates: MediaCandidate[] = [];
  for (const { name, value } of tagAttributes(tag)) {
    // The HTML tokenizer resolves character references before URL
    // parsing, so decode first: an encoded `https&#58;//...` is a valid
    // absolute URL to the browser.
    if (name === 'src') {
      if (value)
        candidates.push({ url: decodeHTMLAttribute(value), valid: true });
    } else if (name === 'srcset') {
      for (const candidate of splitSrcsetCandidates(
        decodeHTMLAttribute(value)
      )) {
        const candidateUrl = candidate.trim().split(/\s+/, 1)[0];
        if (candidateUrl) {
          candidates.push({
            url: candidateUrl,
            valid: isValidSrcsetDescriptor(candidate),
          });
        }
      }
    }
  }
  return candidates;
}

function isImportableMediaUrl(url: string): boolean {
  // Embedded data: URLs are rejected outright: no MIME check or payload
  // sniffing can prove the bytes decode to a renderable image without a
  // real decoder, so handoff imports require hosted HTTPS media. The
  // reviewer hosts the image (or uses the upload API) instead.
  return isHttpsUrl(url);
}

function imgHasSrcValue(tag: string): boolean {
  // The editor parses `img[src]` and drops src-less images on mount.
  return tagAttributes(tag).some(
    ({ name, value }) => name === 'src' && value.trim() !== ''
  );
}

/**
 * Whether any media group is broken: candidates are evaluated per
 * picture while every img still needs its own src, since the editor
 * drops src-less images on mount whatever the picture sources
 * supply. Pictures without media elements are inert, not broken.
 */
export function hasBrokenMediaTag(html: string): boolean {
  return groupMediaElements(html).some(({ tags, hasMedia }) => {
    if (!hasMedia) return false;
    if (tags.some((tag) => /^<img\b/i.test(tag) && !imgHasSrcValue(tag))) {
      return true;
    }
    const candidates = tags.flatMap(mediaTagCandidates);
    return (
      candidates.length === 0 ||
      candidates.some(({ url, valid }) => !valid || !isImportableMediaUrl(url))
    );
  });
}
