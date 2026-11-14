interface ComposingKeyEvent {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}

/** `keyCode` browsers report on keydown while an IME is consuming the key. */
const IME_PROCESS_KEY_CODE = 229;

/**
 * True when a keydown belongs to an in-progress IME composition (Chinese,
 * Japanese, Korean keyboards), where Enter confirms a character candidate and
 * must not submit or commit anything.
 *
 * Accepts a DOM or React keyboard event. The `keyCode === 229` check covers
 * Safari, which can report `isComposing: false` on the confirming Enter.
 */
export function isImeComposing(event: ComposingKeyEvent): boolean {
  const native = event.nativeEvent ?? event;
  return (
    native.isComposing === true ||
    native.keyCode === IME_PROCESS_KEY_CODE ||
    event.keyCode === IME_PROCESS_KEY_CODE
  );
}
