/** Local read-only rendering experiment. Not a production runtime or commerce host. */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const root = new URL(
  '../../../../.superpowers/sdd/2026-10-25-experience-cwv/artifacts/',
  import.meta.url
);
const read = (name: string) => readFileSync(new URL(name, root));
const receipt = JSON.parse(read('receipt.json').toString());
if (receipt.prototypeOnly !== true || receipt.releaseQualified !== false)
  throw Error('Expected unqualified local prototype');
const bootstrap = JSON.parse(read('bootstrap.json').toString());
const hostOrigin = 'http://127.0.0.1:43176';
const frameOrigin = 'http://127.0.0.1:43177';
const js = `const frame=document.querySelector('iframe');frame.addEventListener('load',()=>{const channel=new MessageChannel();channel.port1.onmessage=event=>{if(event.data?.type==='ready'&&event.data.nonce==='local-read-only-prototype'){channel.port1.postMessage({type:'bootstrap',bootstrap:${JSON.stringify(bootstrap)}});return;}if(typeof event.data?.requestId==='string')channel.port1.postMessage({type:'result',requestId:event.data.requestId,result:{status:'error',code:'INSUFFICIENT_SCOPE',message:'Read-only prerender experiment. Use the Baci preview for commerce.'}});};channel.port1.start();frame.contentWindow.postMessage({type:'baci-experience-connect',nonce:'local-read-only-prototype',instanceId:'local-prerender',buildDigest:${JSON.stringify(receipt.javascriptDigest)}},'*',[channel.port2]);});`;
const parent = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none';script-src 'self';style-src 'unsafe-inline';frame-src ${frameOrigin};base-uri 'none';form-action 'none'`
  );
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  if (req.url === '/parent.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(js);
    return;
  }
  if (!['/', '/baseline'].includes(req.url ?? '')) {
    res.writeHead(404).end();
    return;
  }
  const baseline = req.url === '/baseline';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbit ${baseline ? 'client-rendered baseline' : 'prerender prototype'}</title><style>html,body{margin:0}aside{height:32px;box-sizing:border-box;background:#171717;color:#fff;font:12px system-ui;padding:8px}iframe{display:block;width:100%;height:calc(100svh - 32px);border:0}a{color:#d7ee97}</style></head><body><aside>LOCAL READ-ONLY EXPERIMENT · CWV UNQUALIFIED · <a href="${baseline ? '/' : '/baseline'}">${baseline ? 'Prerender' : 'Baseline'}</a></aside><iframe title="Orbit rendering experiment" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${frameOrigin}/${baseline ? 'baseline.html' : 'index.html'}"></iframe><script src="/parent.js" defer></script></body></html>`
  );
});
const child = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self';font-src 'self';connect-src 'none';form-action 'none';base-uri 'none';frame-ancestors ${hostOrigin}`
  );
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  const names: Record<string, [string, string]> = {
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript'],
    '/app.css': ['app.css', 'text/css'],
    '/baseline.js': ['baseline.js', 'text/javascript'],
    '/assets/synthetic-device-image': [
      'synthetic-device-image.png',
      'image/png',
    ],
  };
  if (req.url === '/baseline.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/baseline.js"></script></body></html>'
    );
    return;
  }
  const file = names[req.url ?? ''];
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type', file[1]);
  res.end(read(file[0]));
});
await new Promise<void>((resolve, reject) => {
  child.once('error', reject);
  child.listen(43177, '127.0.0.1', resolve);
});
await new Promise<void>((resolve, reject) => {
  parent.once('error', reject);
  parent.listen(43176, '127.0.0.1', resolve);
});
const close = () => {
  parent.closeAllConnections();
  child.closeAllConnections();
  parent.close();
  child.close();
};
process.once('SIGTERM', close);
process.once('SIGINT', close);
console.log(
  'Orbit read-only prerender prototype: http://127.0.0.1:43176/ ; original commerce preview remains on43174.'
);
