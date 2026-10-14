import { useState } from 'react';

/** Keep native edits intact until blur while the form stores normalized data. */
export function useNativeInputDraft(value: string, displayValue = value) {
  const [draft, setDraft] = useState<{
    text: string;
    normalized: string;
  } | null>(null);

  // External resets replace the draft; clearing it also prevents stale text
  // reappearing if the form later returns to the same normalized value.
  if (draft && draft.normalized !== value) setDraft(null);

  return {
    displayValue: draft?.normalized === value ? draft.text : displayValue,
    setDraft: (text: string, normalized: string) =>
      setDraft({ text, normalized }),
    clearDraft: () => setDraft(null),
  };
}
