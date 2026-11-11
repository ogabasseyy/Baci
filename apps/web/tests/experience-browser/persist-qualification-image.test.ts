import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { persistQualificationImage } from './persist-qualification-image';

describe('durable qualification capture evidence', () => {
  it('survives a later test-output cleanup and rejects traversal, invalid and oversized captures', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'experience-evidence-'));
    try {
      const temporary = path.join(root, 'test-output');
      mkdirSync(temporary);
      const image = await sharp({
        create: { width: 1, height: 1, channels: 3, background: '#4466aa' },
      })
        .png()
        .toBuffer();
      const capture = persistQualificationImage(
        path.join(root, 'durable'),
        'chromium-390-editorial.png',
        image
      );
      rmSync(temporary, { recursive: true });
      expect(readFileSync(capture.filename)).toEqual(image);
      expect(capture.sha256).toHaveLength(64);
      expect(() =>
        persistQualificationImage(root, '../escape.png', image)
      ).toThrow();
      expect(() =>
        persistQualificationImage(root, 'bad.png', Buffer.from('not png'))
      ).toThrow();
      expect(() =>
        persistQualificationImage(
          root,
          'large.png',
          Buffer.alloc(2 * 1024 * 1024 + 1)
        )
      ).toThrow('budget');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
