import type { ColorScheme } from './review-handoff-breakpoints';
import { elementFrame, type HidingFrame } from './review-handoff-element-frame';
import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { imageSizeZeroAt } from './review-handoff-size-markers';
import { subtreeHiddenAt } from './review-handoff-subtree-hidden';
import { tagAttributes } from './review-handoff-tag-attributes';
import { VOID_HTML_ELEMENTS } from './review-handoff-void-elements';
import { stripHtmlComments } from './strip-html-comments';

// Without a breakpoint or scheme prefix every layer is bare, so each
// element's verdict is constant across points and schemes: skip the
// ancestry walk entirely for the common class-less article.
const VARIANCE_PREFIX_PATTERN = /(?:max-)?(?:sm|md|lg|xl|2xl):|dark:/;

function verdictsVary(hiddenAt: readonly boolean[]): boolean {
  return hiddenAt.some((hidden) => hidden !== hiddenAt[0]);
}

function imageZeroVaries(tag: string): boolean {
  // Replaced content conforms to a zeroed axis without needing a
  // clipping rule, so an image's own zero sizing varies independently
  // of the generic frame verdicts: `h-0 md:h-auto` renders nothing
  // below md whatever the ancestry says.
  const classes: string[] = [];
  let widthAttrZero = false;
  let heightAttrZero = false;
  for (const { name, value } of tagAttributes(tag)) {
    if (name === 'class') {
      classes.push(...value.split(/\s+/));
      continue;
    }
    if (name === 'width' && /^0+$/.test(value.trim())) widthAttrZero = true;
    if (name === 'height' && /^0+$/.test(value.trim())) heightAttrZero = true;
  }
  const schemes: ColorScheme[] = ['light', 'dark'];
  const runs = schemes.map((scheme) =>
    imageSizeZeroAt(classes, widthAttrZero, heightAttrZero, scheme)
  );
  return (
    runs.some(verdictsVary) ||
    runs[0].some((zero, point) => zero !== runs[1][point])
  );
}

/**
 * Whether any element hides at some evaluation cells but shows at others.
 * The editor drops input classes, so viewport- or theme-dependent hiding
 * cannot survive the round-trip: kept content would surface at viewports
 * or schemes where the source hides it. Effective (ancestry-combined)
 * verdicts decide, mirroring the strip: terminal hiding anywhere wins,
 * visibility and color resolve to the nearest marker, and void elements
 * never consult the color channel.
 */
export function hasUnrepresentableVariance(content: string): boolean {
  if (!VARIANCE_PREFIX_PATTERN.test(content)) return false;
  const withoutComments = stripHtmlComments(content);
  const light: HidingFrame[] = [];
  const dark: HidingFrame[] = [];
  for (const match of withoutComments.matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') {
      light.pop();
      dark.pop();
      continue;
    }
    const tagName = match[2].toLowerCase();
    if (tagName === 'img' && imageZeroVaries(match[0])) return true;
    light.push(elementFrame(match[0], 'light'));
    dark.push(elementFrame(match[0], 'dark'));
    const includeColor = !VOID_HTML_ELEMENTS.has(tagName);
    const lightHidden = subtreeHiddenAt(light, includeColor);
    const darkHidden = subtreeHiddenAt(dark, includeColor);
    const varies =
      verdictsVary(lightHidden) ||
      verdictsVary(darkHidden) ||
      lightHidden[0] !== darkHidden[0];
    if (VOID_HTML_ELEMENTS.has(tagName)) {
      light.pop();
      dark.pop();
    }
    if (varies) return true;
  }
  return false;
}
