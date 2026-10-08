import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDeliveryGuard, decideTierDelivery } from './delivery.mjs';

const AVIF_SOURCE = {
  bytes: 10186,
  format: 'avif',
  orientedHeight: 800,
  orientedWidth: 800,
  sha256: '29930849ef1a0727ce9ca64dbc524c033576485c8fa934e63bfe05b01a555db5',
};

const PNG_SOURCE = {
  bytes: 2123511,
  format: 'png',
  orientedHeight: 1122,
  orientedWidth: 1122,
  sha256: '1a13cbbab693750a5db34f77b1a36dbcdbf842b58f8ece3c62b5a23117ec2654',
};

function rung(overrides) {
  return {
    actualWidth: 768,
    bytes: 16288,
    contentType: 'image/avif',
    format: 'avif',
    height: 768,
    path: 'staging/tier.avif',
    quality: 70,
    requestedWidth: 768,
    sha256: '5d79f51c004c17dced93cab3241e345fca84c58cce565f7be5c92f791c56d7f6',
    width: 768,
    ...overrides,
  };
}

test('efficient AVIF source passes through when the rung is larger', () => {
  const decided = decideTierDelivery({ rung: rung(), source: AVIF_SOURCE });
  assert.equal(decided.delivery, 'original-passthrough');
  assert.equal(decided.bytes, AVIF_SOURCE.bytes);
  assert.equal(decided.sha256, AVIF_SOURCE.sha256);
  assert.equal(decided.width, 800);
  assert.equal(decided.actualWidth, 800);
  assert.equal(decided.height, 800);
  assert.equal(decided.quality, null);
  assert.equal(decided.format, 'avif');
  assert.equal(decided.contentType, 'image/avif');
  assert.equal(decided.requestedWidth, 768);
});

test('beneficial PNG rung keeps the generated derivative', () => {
  const decided = decideTierDelivery({
    rung: rung({
      bytes: 86379,
      format: 'avif',
      sha256:
        'ee454fa19f19123cef2affa3bd7e6c126c4335f3245cc420169b844ae25f3d31',
    }),
    source: PNG_SOURCE,
  });
  assert.equal(decided.delivery, 'generated');
  assert.equal(decided.bytes, 86379);
  assert.equal(decided.quality, 70);
});

test('byte-equality boundary keeps the derivative (not larger)', () => {
  const decided = decideTierDelivery({
    rung: rung({ bytes: AVIF_SOURCE.bytes }),
    source: AVIF_SOURCE,
  });
  assert.equal(decided.delivery, 'generated');
  assert.equal(decided.bytes, AVIF_SOURCE.bytes);
});

test('incompatible original codec is never forced into a typed branch', () => {
  const decided = decideTierDelivery({
    rung: rung({ bytes: PNG_SOURCE.bytes + 1 }),
    source: PNG_SOURCE,
  });
  assert.equal(decided.delivery, 'generated-over-source');
  assert.equal(decided.bytes, PNG_SOURCE.bytes + 1);
  assert.equal(decided.format, 'avif');
});

test('mixed ladder: small rungs generated, large compatible rungs pass through', () => {
  const tiers = [
    rung({ bytes: 7770, requestedWidth: 384, width: 384, actualWidth: 384 }),
    rung({ bytes: 16288, requestedWidth: 768, width: 768, actualWidth: 768 }),
    rung({ bytes: 14956, requestedWidth: 1280, width: 800, actualWidth: 800 }),
  ];
  const applied = applyDeliveryGuard({ source: AVIF_SOURCE, tiers });
  assert.deepEqual(
    applied.map((tier) => tier.delivery),
    ['generated', 'original-passthrough', 'original-passthrough']
  );
  assert.equal(applied[0].bytes, 7770);
  assert.equal(applied[1].bytes, AVIF_SOURCE.bytes);
  assert.equal(applied[2].width, 800);
});

test('webp branch with an AVIF source keeps generated tiers with a limitation', () => {
  const applied = applyDeliveryGuard({
    source: AVIF_SOURCE,
    tiers: [
      rung({
        bytes: 16080,
        contentType: 'image/webp',
        format: 'webp',
        requestedWidth: 768,
      }),
    ],
  });
  assert.equal(applied[0].delivery, 'generated-over-source');
  assert.equal(applied[0].bytes, 16080);
});

test('rejects non-body-byte or unknown inputs instead of guessing', () => {
  assert.throws(
    () => decideTierDelivery({ rung: rung({ bytes: 0 }), source: AVIF_SOURCE }),
    /positive body bytes/
  );
  assert.throws(
    () =>
      decideTierDelivery({
        rung: rung(),
        source: { ...AVIF_SOURCE, format: 'heif' },
      }),
    /normalized source format/
  );
});
