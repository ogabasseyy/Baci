/**
 * Safe Clipboard Utility
 * Prevents crashes on development builds when the native expo-clipboard module is missing.
 */

/**
 * Copies text to the clipboard safely.
 * Returns true if successful, false if the module is missing or an error occurred.
 */
export async function setClipboardString(text: string): Promise<boolean> {
  try {
    // 2026 ESM Pattern: Use dynamic import() for native modules
    const Clipboard = await import('expo-clipboard');

    if (Clipboard && typeof Clipboard.setStringAsync === 'function') {
      await Clipboard.setStringAsync(text);
      return true;
    }

    console.warn('[Clipboard] Native module setStringAsync not found.');
    return false;
  } catch (error) {
    console.warn('[Clipboard] Failed to copy to clipboard:', error);

    // In some development environments, we might want to alert the user.
    // Never log the value itself: clipboard payloads routinely contain
    // account numbers and other PII that must not land in Metro output.
    if (__DEV__) {
      console.log(
        `[Clipboard Debug] Copy failed for payload of length ${text.length}`
      );
    }

    return false;
  }
}

export function isClipboardAvailable(): boolean {
  try {
    // For synchronous check in dev env, require is still a valid escape hatch
    // until Metro fully disables it for native modules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require('expo-clipboard');
    return !!(
      Clipboard &&
      (Clipboard.setStringAsync || Clipboard.default?.setStringAsync)
    );
  } catch {
    return false;
  }
}
