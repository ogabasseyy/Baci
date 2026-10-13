import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MPEG_1_LAYER_3_BITRATES_KBPS = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
] as const;

function readFirstFrameQuality(fileName: string) {
  const audio = readFileSync(
    resolve(__dirname, '../../assets/quiz/audio', fileName)
  );

  for (let index = 0; index < audio.length - 4; index += 1) {
    const byte1 = audio[index];
    const byte2 = audio[index + 1];
    const byte3 = audio[index + 2];
    const byte4 = audio[index + 3];
    const isMpeg1Layer3 =
      byte1 === 0xff &&
      (byte2 & 0xe0) === 0xe0 &&
      ((byte2 >> 3) & 0x03) === 0x03 &&
      ((byte2 >> 1) & 0x03) === 0x01;

    if (!isMpeg1Layer3) continue;

    const bitrateIndex = (byte3 >> 4) & 0x0f;
    return {
      bitrateKbps: MPEG_1_LAYER_3_BITRATES_KBPS[bitrateIndex] ?? 0,
      isMono: ((byte4 >> 6) & 0x03) === 0x03,
    };
  }

  throw new Error(`No MPEG-1 Layer III frame found in ${fileName}`);
}

describe('quiz music asset quality', () => {
  it.each([
    'nobody-does-it-better.mp3',
    'ogabassey-no-dey-disappoint-1.mp3',
  ])('keeps %s at 128 kbps or higher in stereo', (fileName) => {
    const quality = readFirstFrameQuality(fileName);

    expect(quality.bitrateKbps).toBeGreaterThanOrEqual(128);
    expect(quality.isMono).toBe(false);
  });
});
