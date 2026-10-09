import { parseHandoffDom } from './review-handoff-dom';

/**
 * Whether markup hides content behind a closed disclosure control.
 * Neither the sanitizer allowlist nor the editor extensions
 * represent details/summary, so sanitization unwraps the control
 * and stores collapsed content as permanently visible text. An
 * `open` details element renders its content in the source document
 * already, so only closed disclosures drift. Attribute presence
 * comes from the parsed DOM, so data-open and quoted mentions never
 * count.
 */
export function hasClosedDisclosure(html: string): boolean {
  return parseHandoffDom(html).querySelector('details:not([open])') !== null;
}
