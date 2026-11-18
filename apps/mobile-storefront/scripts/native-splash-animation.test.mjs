import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createSplashAnimation } from './native-splash-animation.mjs';

test('native splash embeds all artwork and preserves independent motion layers', () => {
  const animation = createSplashAnimation();
  assert.deepEqual([animation.w, animation.h, animation.fr, animation.op], [450, 876, 30, 180]);
  assert.ok(animation.assets.every((asset) => asset.p.startsWith('data:image/png;base64,')));
  const find = (name) => animation.layers.find((layer) => layer.nm === name);
  for (const name of ['phone-motion', 'leg-front', 'leg-back', 'torso', 'logo-mark', 'logo-wordmark', 'tagline', 'cloud-1', 'cloud-2', 'cloud-3', 'earbuds', 'watch', 'laptop', 'controller', 'loading-message']) assert.ok(find(name), `${name} missing`);
  assert.equal(find('orbit-trail'), undefined, 'gadgets no longer have a curved trail');
  assert.equal(find('logo-mark').ks.o.k.at(-1).s[0], 100, 'logo remains visible when playback finishes');
  assert.equal(find('tagline').ks.o.k.at(-1).s[0], 100, 'tagline remains visible when playback finishes');
  assert.equal(find('leg-front').parent, find('phone-motion').ind);
  assert.equal(find('leg-back').parent, find('phone-motion').ind);
  assert.notDeepEqual(find('leg-front').ks.r.k[0].s, find('leg-back').ks.r.k[0].s);
  assert.ok(find('phone-motion').ks.p.k.at(-1).s[0] > find('phone-motion').ks.p.k[0].s[0]);
  assert.ok(find('cloud-1').ks.p.k.at(-1).s[0] < find('cloud-1').ks.p.k[0].s[0]);
  assert.ok(find('watch').ks.o.k[1].t < find('laptop').ks.o.k[1].t);
  const walker = find('phone-motion');
  const walkerFrames = walker.ks.p.k;
  const [start, middle] = walkerFrames;
  const torso = find('torso');
  const torsoAsset = animation.assets.find((asset) => asset.id === torso.refId);
  const halfTorso = torsoAsset.w * torso.ks.s.k[0] / 200;
  const firstOpaqueFrame = torso.ks.o.k[1].t;
  const walkerAtFirstOpaque = start.s[0] + (middle.s[0] - start.s[0]) * firstOpaqueFrame / middle.t;
  assert.ok(start.s[0] + torso.ks.p.k[0] - halfTorso <= 0, 'phone enters from the left edge');
  assert.ok(walkerAtFirstOpaque + torso.ks.p.k[0] + halfTorso <= animation.w / 4, 'the first fully visible pose stays in the left quarter');
  const [endX] = walkerFrames.at(-1).s;
  assert.ok(endX >= animation.w + 100, 'phone exits completely to the right');
  assert.ok(walkerFrames.every((frame, index) => !index || frame.s[0] > walkerFrames[index - 1].s[0]), 'walker keeps moving right');
  for (const name of ['leg-front', 'leg-back']) {
    const rotation = find(name).ks.r.k;
    assert.ok(rotation.at(-1).t > animation.op, `${name} keeps cycling through the exit`);
    assert.notDeepEqual(rotation.at(-1).s, rotation.at(-2).s, `${name} does not settle before exit`);
  }
  for (const name of ['earbuds', 'watch', 'laptop', 'controller']) {
    const device = find(name);
    assert.equal(device.parent, walker.ind, `${name} follows the phone`);
    assert.equal(device.ks.p.a, 0, `${name} retains its position relative to the phone`);
    assert.equal(device.ks.o.k.at(-1).s[0], 100, `${name} remains visible`);
    const asset = animation.assets.find((entry) => entry.id === device.refId);
    const width = asset.w * device.ks.s.k[0] / 100;
    const height = asset.h * device.ks.s.k[1] / 100;
    for (const { s: [, y] } of walker.ks.p.k) {
      const [, dy] = device.ks.p.k;
      assert.ok(y + dy - height / 2 >= 0 && y + dy + height / 2 <= animation.h, `${name} vertical bounds`);
    }
    const fullyVisible = device.ks.o.k[2].t;
    const parentX = start.s[0] + (middle.s[0] - start.s[0]) * fullyVisible / middle.t;
    assert.ok(parentX + device.ks.p.k[0] - width / 2 >= 0, `${name} is on screen when fully visible`);
    assert.ok(endX + device.ks.p.k[0] - width / 2 >= animation.w, `${name} exits right`);
  }
  assert.deepEqual(JSON.parse(readFileSync(new URL('../assets/splash-scene/native-splash.json', import.meta.url))), animation);
});
