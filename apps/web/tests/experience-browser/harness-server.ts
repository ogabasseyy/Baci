import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { PublicCatalog } from '@baci/shared/experience';
import type { OfflineAsset } from '../../tools/experience-runner/materialize-assets';
import {
  renderSemanticSnapshot,
  type SemanticSnapshot,
} from '../../tools/experience-runner/semantic-snapshot';
export interface QualificationInput {
  mode: string;
  engine: 'chromium' | 'firefox' | 'webkit';
  width: number;
  bundle: { javascript: string; css: string };
  catalog: PublicCatalog;
  assets: OfflineAsset[];
}
export async function startQualificationServers(
  input: QualificationInput,
  snapshots: Map<string, SemanticSnapshot>,
  ports: [number, number] = [4100, 4101]
) {
  const servers: Server[] = [];
  let forbiddenRequests = 0;
  const assets = new Map<string, { bytes: Buffer; mime: string }>();
  for (const asset of input.assets) {
    const bytes = Buffer.from(asset.bytesBase64, 'base64');
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      asset.digest,
      'Asset digest mismatch'
    );
    assets.set(`/assets/${asset.digest}`, { bytes, mime: asset.mime });
    assets.set(`/assets/${asset.assetId}`, { bytes, mime: asset.mime });
  }
  const image = input.assets.find((a) => a.mime === 'image/png');
  const font = input.assets.find((a) => a.mime === 'font/woff2');
  assert.ok(image && font, 'Missing offline image/font');
  const assetMarkup = `<section style="font-family:OfflineFixture,monospace"><h2>Offline asset probe</h2><img src="/assets/${image.digest}" alt="Synthetic blue swatch" width="32" height="24"><p id="price">USD <span hidden>NESTED_HIDDEN_SENTINEL</span><span style="display:none">NESTED_CSS_SENTINEL</span>10.00</p><figure><canvas width="32" height="24"></canvas><figcaption>Synthetic canvas alternative</figcaption></figure><p style="margin-top:1200px">Below fold semantic content</p><h2>Buy <a href="/products/device"><em>Device</em></a> today</h2><p hidden>HIDDEN_SENTINEL</p><div role="dialog"><p>MODAL_SENTINEL</p></div><p style="opacity:0">INVISIBLE_SENTINEL</p><a href="https://private.invalid/ticket">Safe link label</a></section>`;
  const bootstrap = { catalog: input.catalog };
  const hostScript = `const frame=document.querySelector('iframe');let epoch=0;function route(path){return {epoch:++epoch,canonicalPath:path,routeId:path==='/'?'home':path.startsWith('/collections/')?'collection':path.startsWith('/products/')?'product':'editorial',params:{},publicDataRevision:'synthetic-1'}};frame.onload=()=>{const channel=new MessageChannel();channel.port1.onmessage=e=>{if(e.data.type==='ready')channel.port1.postMessage({type:'bootstrap',bootstrap:{...${JSON.stringify(bootstrap)},route:route(location.pathname)}});else if(e.data.type==='navigate'&&['/','/collections/studio','/collections/devices','/products/device','/journal/design'].includes(e.data.path)){history.pushState(null,'',e.data.path);channel.port1.postMessage({type:'route',route:route(e.data.path)})}else if(e.data.type==='open'&&e.data.routeId==='product'&&e.data.requestId==='synthetic-one'){document.getElementById('presentation').hidden=false;document.getElementById('canonical').focus()}};frame.contentWindow.postMessage('qualification-connect','*',[channel.port2])};document.getElementById('cancel').onclick=()=>{document.getElementById('presentation').hidden=true;frame.focus()};`;
  async function serve(port: number, handler: RequestListener) {
    const server = createServer(handler);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    servers.push(server);
  }
  await serve(ports[0], (req, res) => {
    if (req.url?.startsWith('/forbidden')) forbiddenRequests++;
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; frame-src http://127.0.0.1:4101; style-src 'unsafe-inline'"
    );
    res.setHeader(
      'Content-Type',
      req.url === '/host.js' ? 'text/javascript' : 'text/html'
    );
    if (req.url === '/host.js') return void res.end(hostScript);
    const snapshot = snapshots.get(req.url ?? '/');
    const fallback = snapshot
      ? renderSemanticSnapshot(snapshot, 'synthetic-1')
      : '';
    res.end(
      `<!doctype html><html><head><title>Synthetic route ${snapshot?.path ?? '/'}</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="canonical" href="http://127.0.0.1:4100${snapshot?.path ?? '/'}"></head><body><style>body{margin:0}iframe{display:block;border:0;width:100%;height:100vh}#presentation{position:fixed;bottom:0;background:white;padding:12px;border:2px solid black;z-index:2}</style>${fallback}<iframe title="Authored experience" sandbox="allow-scripts" src="http://127.0.0.1:4101/"></iframe><aside id="presentation" hidden><a id="canonical" href="/products/device" target="_blank" rel="noopener noreferrer">Open product in new tab</a><a id="same-tab" href="/products/device">Open product here</a><button id="cancel" type="button">Cancel link</button></aside><script src="/host.js"></script></body></html>`
    );
  });
  await serve(ports[1], (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src http://127.0.0.1:4101; style-src http://127.0.0.1:4101 'unsafe-inline'; img-src http://127.0.0.1:4101; font-src http://127.0.0.1:4101; connect-src 'none'; worker-src 'none'; frame-ancestors http://127.0.0.1:4100; base-uri 'none'; form-action 'none'"
    );
    const asset = assets.get(req.url ?? '');
    if (asset) {
      res.setHeader('Content-Type', asset.mime);
      return void res.end(asset.bytes);
    }
    if (req.url === '/entry.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return void res.end(input.bundle.javascript);
    }
    if (req.url === '/entry.css') {
      res.setHeader('Content-Type', 'text/css');
      return void res.end(
        `@font-face{font-family:OfflineFixture;src:url('/assets/${font.digest}') format('woff2')}\n` +
          input.bundle.css
      );
    }
    if (req.url !== '/') {
      res.statusCode = 404;
      return void res.end('Missing offline asset');
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css" crossorigin="anonymous"><div id="root"></div>${assetMarkup}<script type="module" src="/entry.js" crossorigin="anonymous"></script>`
    );
  });

  return { servers, getForbiddenRequests: () => forbiddenRequests };
}
