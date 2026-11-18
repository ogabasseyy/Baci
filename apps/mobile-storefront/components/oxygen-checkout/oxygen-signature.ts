import {
  type OxygenTransientFile,
  validateOxygenFile,
} from '@baci/shared/oxygen';
export interface SignaturePoint {
  x: number;
  y: number;
}
export function clampSignaturePoint(
  x: number,
  y: number,
  width: number,
  height: number
): SignaturePoint {
  return {
    x: Math.min(width, Math.max(0, Number.isFinite(x) ? x : 0)),
    y: Math.min(height, Math.max(0, Number.isFinite(y) ? y : 0)),
  };
}
export function signaturePath(points: SignaturePoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
}
export function signaturePng(base64: string): OxygenTransientFile | null {
  if (
    !base64 ||
    base64.length > 2097152 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    return null;
  try {
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0)
    );
    return validateOxygenFile(bytes, 'image/png', 'signature.png')
      ? { bytes, type: 'image/png', name: 'signature.png' }
      : null;
  } catch {
    return null;
  }
}
