import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Lightweight raster layers preserve the approved illustration. The tagline is
// baked into a transparent PNG to avoid platform-dependent font substitution.
const TAGLINE = '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';
const duration = 180;
const still = (k) => ({ a: 0, k });
const easing = { i: { x: [0.42], y: [1] }, o: { x: [0.58], y: [0] } };
const linearEasing = { i: { x: [1], y: [1] }, o: { x: [0], y: [0] } };
function animate(points, linear = false) {
  return { a: 1, k: points.map(([t, s], index) => index === points.length - 1 ? { t, s } : { t, s, e: points[index + 1][1], ...(linear ? linearEasing : easing) }) };
}
export function createSplashAnimation() {
  const files = ['background','cloud','mark','wordmark','torso','leg','device-0','device-1','device-2','device-3','loading-message'];
  const assets = files.map((name) => {
    const data = readFileSync(new URL(`../assets/splash-scene/${name}.png`, import.meta.url));
    return { id: name, w: data.readUInt32BE(16), h: data.readUInt32BE(20), u: '', p: `data:image/png;base64,${data.toString('base64')}`, e: 1 };
  });
  const tagline = Buffer.from(TAGLINE, 'base64');
  assets.push({ id: 'tagline', w: tagline.readUInt32BE(16), h: tagline.readUInt32BE(20), u: '', p: `data:image/png;base64,${TAGLINE}`, e: 1 });
  let id = 0;
  const image = (name, ref, x, y, width, opts = {}) => {
    const asset = assets.find((entry) => entry.id === ref);
    const scale = width / asset.w * 100;
    return { ddd: 0, ind: ++id, ty: 2, nm: name, refId: ref, sr: 1, ...(opts.parent ? { parent: opts.parent } : {}), ks: { o: opts.opacity ?? still(100), r: opts.rotation ?? still(0), p: opts.position ?? still([x,y,0]), a: still(opts.anchor ?? [asset.w/2,asset.h/2,0]), s: still([scale,scale,100]) }, ao: 0, ip: 0, op: duration, st: 0, bm: 0 };
  };
  const layers = [];
  // A parent layer keeps the feet and body together along the floor.
  const walker = { ddd: 0, ind: ++id, ty: 3, nm: 'phone-motion', sr: 1, ks: { o: animate([[0,[0]],[9,[100]],[180,[100]]]), r: still(0), p: animate([[0,[40,537,0]],[90,[295,550,0]],[180,[550,576,0]]], true), a: still([0,0,0]), s: still([100,100,100]) }, ao: 0, ip: 0, op: duration, st: 0, bm: 0 };
  const phoneFade = animate([[0,[0]],[9,[100]],[180,[100]]]);
  const torso = image('torso','torso',81,65,162,{parent:walker.ind,opacity:phoneFade});
  const legAsset = assets.find((asset) => asset.id === 'leg');
  const legWidth = 61.56;
  const legScale = legWidth / legAsset.w * 100;
  const legFrames = [];
  for (let t=0; t<=duration+21; t+=21) legFrames.push([t, [Math.round((t/21)%2 === 0 ? -34 : 34)]]);
  const legFront = image('leg-front','leg',110,105,legWidth,{parent:walker.ind, anchor:[legAsset.w * .45,legAsset.h * .08,0],rotation:animate(legFrames),opacity:phoneFade});
  const legBack = image('leg-back','leg',76,105,legWidth,{parent:walker.ind, anchor:[legAsset.w * .45,legAsset.h * .08,0],rotation:animate(legFrames.map(([t,[angle]])=>[t,[angle === 0 ? 0 : -angle]])),opacity:animate([[0,[0]],[9,[78]],[180,[78]]])});
  // Layers are ordered front to back by Lottie.
  layers.push(torso, legFront, legBack, walker);
  // Devices share the walker's translation and retain their relative positions.
  const devices = [
    ['earbuds', 'device-0', 0, 64, 65, -115],
    ['watch', 'device-2', 14, 62, 135, -55],
    ['laptop', 'device-1', 33, 96, 145, -125],
    ['controller', 'device-3', 53, 70, 195, -55],
  ];
  for (const [name, ref, delay, width, x, y] of devices) {
    layers.push(image(name,ref,x,y,width,{parent:walker.ind,opacity:animate([[0,[0]],[delay+10,[0]],[delay+25,[100]],[180,[100]]])}));
  }
  const logoFade=animate([[0,[0]],[18,[100]],[180,[100]]]);
  layers.push(image('logo-mark','mark',80,289,49,{rotation:animate([[0,[0]],[16,[0]],[47,[360]],[180,[360]]]),opacity:logoFade}));
  layers.push(image('logo-wordmark','wordmark',248,289,289,{opacity:logoFade}));
  layers.push(image('tagline','tagline',225,341,230,{opacity:animate([[0,[0]],[22,[0]],[40,[100]],[180,[100]]])}));
  layers.push(image('loading-message','loading-message',225,394,218,{opacity:animate([[0,[0]],[152,[0]],[178,[100]],[180,[100]]])}));
  for (const [name,x,y,width] of [['cloud-1',102,77,243],['cloud-2',370,128,171],['cloud-3',230,198,112]]) {
    layers.push(image(name,'cloud',x,y,width,{position:animate([[0,[x+width*.16,y,0]],[180,[x-width*.16,y,0]]],true)}));
  }
  layers.push(image('background','background',225,438,450));
  return {v:'5.7.4',fr:30,ip:0,op:duration,w:450,h:876,nm:'Ogabassey native splash',ddd:0,assets,layers,markers:[{tm:0,cm:'loop',dr:duration}]};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) writeFileSync(new URL('../assets/splash-scene/native-splash.json', import.meta.url), JSON.stringify(createSplashAnimation()));
