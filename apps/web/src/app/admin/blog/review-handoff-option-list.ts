import { parseHandoffDom } from './review-handoff-dom';

// Option-list markup has no editor node, and sanitization drops
// these subtrees entirely — tag and text together. Datalist options
// never render, so their drop is invisible; but a select control
// (and any orphaned option text the browser does render) vanishes
// silently while surrounding body text lets the import succeed.
// Reject before that lossy step.
const UNREPRESENTABLE_OPTION_LIST_SELECTOR = 'datalist,select,option,optgroup';

/**
 * Whether markup carries an option list the editor cannot preserve.
 * Runs pre-sanitize, since sanitization itself removes the evidence.
 */
export function hasUnrepresentableOptionList(html: string): boolean {
  return (
    parseHandoffDom(html).querySelector(
      UNREPRESENTABLE_OPTION_LIST_SELECTOR
    ) !== null
  );
}
