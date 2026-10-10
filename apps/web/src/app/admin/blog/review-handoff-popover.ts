import { parseHandoffDom } from './review-handoff-dom';

/**
 * Whether markup hides content in a popover. A popover element is
 * hidden until shown, and static markup cannot express the shown
 * state (there is no open attribute to preserve); the sanitizer
 * allowlist drops the popover attribute while keeping the element
 * and its children, exposing the note as permanently visible text.
 * Runs pre-sanitize, since sanitization itself removes the evidence.
 * Attribute presence comes from the parsed DOM, so quoted mentions
 * of "popover" never count while popover="manual" and bare popover
 * both hide.
 */
export function hasUnopenedPopover(html: string): boolean {
  return parseHandoffDom(html).querySelector('[popover]') !== null;
}
