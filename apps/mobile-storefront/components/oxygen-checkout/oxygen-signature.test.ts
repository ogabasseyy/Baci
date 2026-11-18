import {
  clampSignaturePoint,
  signaturePath,
  signaturePng,
} from './oxygen-signature';

describe('native Oxygen signature', () => {
  it('clamps strokes to stable canvas bounds without expand rescaling', () => {
    expect(clampSignaturePoint(-10, 400, 300, 150)).toEqual({ x: 0, y: 150 });
    expect(
      signaturePath([
        { x: 0, y: 0 },
        { x: 300, y: 150 },
      ])
    ).toBe('M 0 0 L 300 150');
  });
  it('requires actual bounded PNG bytes and never persists capture', () => {
    expect(signaturePng('aGVsbG8=')).toBeNull();
    const file = signaturePng('iVBORw0KGgo=');
    expect(file?.name).toBe('signature.png');
    expect(file?.type).toBe('image/png');
    expect(file?.bytes).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    );
    expect(signaturePng('a'.repeat(3000000))).toBeNull();
  });
});
