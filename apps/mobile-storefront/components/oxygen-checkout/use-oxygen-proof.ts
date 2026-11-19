import { validateOxygenFile } from '@baci/shared/oxygen';
import { File } from 'expo-file-system';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { validateOxygenProof } from './oxygen-form-utils';
import {
  type OxygenProofSource,
  pickOxygenProofSource,
} from './oxygen-proof-source';
export interface OxygenProof {
  name: string;
  type: 'application/pdf' | 'image/jpeg' | 'image/png';
  size: number;
  bytes: Uint8Array;
}
interface OxygenProofAsset {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
  release?: () => void;
}
export interface OxygenProofPicker {
  pick: (source?: OxygenProofSource) => Promise<{
    canceled: boolean;
    assets?: OxygenProofAsset[] | null;
  }>;
  size: (uri: string) => number;
  readBytes: (uri: string) => Promise<Uint8Array>;
}
const nativePicker: OxygenProofPicker = {
  pick: pickOxygenProofSource,
  size: (uri) => new File(uri).size,
  readBytes: (uri) => new File(uri).bytes(),
};
export const OxygenProofPickerContext = createContext(nativePicker);

/** Keep validated bytes in memory and release any cache copy owned by this picker. */
export function useOxygenProof(
  scopeKey: string,
  pickerOverride?: OxygenProofPicker
) {
  const defaultPicker = useContext(OxygenProofPickerContext);
  const picker = pickerOverride ?? defaultPicker;
  const [selected, setSelected] = useState<{
    scope: string;
    file: OxygenProof;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const generation = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scope changes must invalidate transient state and animations.
  useEffect(() => {
    generation.current++;
    setSelected(null);
    setError(null);
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [scopeKey]);
  async function pick(source?: OxygenProofSource) {
    const revision = ++generation.current;
    const scope = scopeRef.current;
    setBusy(true);
    setError(null);
    let asset: OxygenProofAsset | undefined;
    try {
      const result = await picker.pick(source);
      asset = result.assets?.[0];
      if (
        revision !== generation.current ||
        scope !== scopeRef.current ||
        result.canceled
      )
        return;
      if (!asset) {
        setError('Could not read this file. Choose another file.');
        return;
      }
      const size = picker.size(asset.uri);
      const failure = validateOxygenProof({ ...asset, size });
      if (failure) {
        setError(failure);
        return;
      }
      // Validation narrows the MIME contract; no selected file is persisted.
      const type = asset.mimeType;
      if (
        type !== 'application/pdf' &&
        type !== 'image/jpeg' &&
        type !== 'image/png'
      )
        return;
      const bytes = await picker.readBytes(asset.uri);
      if (revision !== generation.current || scope !== scopeRef.current) return;
      if (!validateOxygenFile(bytes, type, asset.name)) {
        setError('Choose a valid PDF, JPEG or PNG file no larger than 1.5 MB.');
        return;
      }
      setSelected({
        scope,
        file: {
          name: asset.name,
          type,
          size: bytes.length,
          bytes,
        },
      });
    } catch {
      if (revision === generation.current)
        setError('Could not open this file. Choose another file.');
    } finally {
      try {
        asset?.release?.();
      } catch {
        // A missing temporary copy does not invalidate the bytes already read.
      }
      if (revision === generation.current) setBusy(false);
    }
  }
  function clear() {
    generation.current++;
    setSelected(null);
    setError(null);
    setBusy(false);
  }
  return {
    proof: selected?.scope === scopeKey ? selected.file : null,
    error,
    busy,
    pick,
    clear,
  };
}
