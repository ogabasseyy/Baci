/** Local prototype entries. Compilation never evaluates merchant modules. */
export function prerenderRuntimeEntry(entry: string) {
  return `
import {renderToReadableStream} from 'react-dom/server.browser';
import {CommerceProvider,createCommerceClient} from '@baci/experience-sdk';
import Experience from './${entry}';
export async function prerender(bootstrap){
  const commerce=createCommerceClient(async()=>({status:'error',code:'LAUNCH_EXPIRED',message:'Commerce is unavailable during prerender.'}));
  let failed=false;
  const stream=await renderToReadableStream(<CommerceProvider commerce={commerce} assets={bootstrap.assets??{}}><Experience route={bootstrap.route} catalog={bootstrap.catalog}/></CommerceProvider>,{onError(){failed=true}});
  await stream.allReady;
  const html=await new Response(stream).text();
  if(failed||new TextEncoder().encode(html).byteLength>2097152)throw Error('PRERENDER_FAILED');
  return {format:'baci-prerender/v1',html};
}`;
}
export function hydrationRuntimeEntry(
  entry: string,
  hostOrigin: string,
  previewOrigin?: string
) {
  return `
import {useEffect,useLayoutEffect,useState} from 'react';
import {hydrateRoot,createRoot} from 'react-dom/client';
import {connectExperience,CommerceProvider} from '@baci/experience-sdk';
import Experience from './${entry}';
const embedded=document.getElementById('baci-prerender-bootstrap');
const bootstrap=embedded?JSON.parse(embedded.textContent):null;
const root=document.getElementById('root');
root.inert=true;
if(bootstrap&&bootstrap.format!=='baci-prerender/v1')throw Error('INVALID_PRERENDER');
const bridge=connectExperience(${JSON.stringify(hostOrigin)},${JSON.stringify({ readiness: 'react-commit/v1', ...(previewOrigin ? { previewOrigin } : {}) })});
let hydrationFailed=false;
function failHydration(){hydrationFailed=true;root.inert=true;document.documentElement.dataset.baciHydration='failed';bridge.failRenderCommit();}
function Runtime({initial}){
  const[data,setData]=useState(initial);
  const[bridgeReady,setBridgeReady]=useState(false);
  useEffect(()=>{let active=true;bridge.ready.then(value=>{if(active){setData(value);setBridgeReady(true)}});const off=bridge.onBootstrap(value=>{if(active){setData(value);setBridgeReady(true)}});const offRoute=bridge.onRoute(route=>{if(active)setData(current=>({...current,route}))});return()=>{active=false;off();offRoute()}},[]);
  useLayoutEffect(()=>{if(!bridgeReady||!data||hydrationFailed)return;if(bridge.acknowledgeRenderCommit(data.route.epoch)){root.inert=false;document.documentElement.dataset.baciHydration='ready'}},[data,bridgeReady]);
  if(!data)return null;
  return <CommerceProvider commerce={bridge.commerce} assets={data.assets??{}}><Experience route={data.route} catalog={data.catalog}/></CommerceProvider>;
}
if(bootstrap)hydrateRoot(root,<Runtime initial={bootstrap.publicData}/>,{onRecoverableError:failHydration,onUncaughtError:failHydration});
else createRoot(root,{onRecoverableError:failHydration,onUncaughtError:failHydration}).render(<Runtime initial={null}/>);
`;
}
