import { parseHandoffDom } from './review-handoff-dom';

/**
 * Whether markup hides content behind a closed dialog. Neither the
 * sanitizer allowlist nor the editor extensions represent dialog,
 * so sanitization unwraps the control and stores hidden content as
 * permanently visible text. An `open` dialog renders its content
 * in the source document already, so only closed dialogs drift.
 * Attribute presence comes from the parsed DOM, so data-open,
 * open-modal, and quoted mentions never count.
 */
export function hasClosedDialog(html: string): boolean {
  return parseHandoffDom(html).querySelector('dialog:not([open])') !== null;
}
