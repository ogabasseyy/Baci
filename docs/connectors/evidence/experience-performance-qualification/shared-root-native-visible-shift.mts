import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {fixtureManifest,fixtureCatalog} from '../../../../apps/web/tests/experience-browser/fixtures/qualification-fixtures';
import {runLocalQualification} from '../../../../apps/web/tools/experience-runner/local-oci-executor';
import {packPrivateBuild} from '../../../../apps/web/tools/experience-runner/private-build-payload';
import {unpackPrerenderBuild} from '../../../../apps/web/tools/experience-runner/prerender-artifacts';
import {createPrivatePrerenderDocument} from '../../../../apps/web/src/lib/experience/private-prerender-document';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const results=[];
for(const name of ['visible-shift','reserved-section']){
 const manifest=fixtureManifest('device-configurator');
 const initial=name==='reserved-section'?320:0;
 manifest.files=[{path:'src/TestStore.tsx',content:`import {useEffect,useState} from 'react';export default function Store(){const[h,setH]=useState(${initial});useEffect(()=>{const t=setTimeout(()=>setH(320),700);return()=>clearTimeout(t)},[]);return <main style={{margin:0,color:'black',background:'white',minHeight:900}}><div style={{height:h}}/><h1>Synthetic visible shift control</h1><p>Stable content below an asynchronous section. No commerce effects.</p><button type="button">Custom interaction</button></main>}`}];
 manifest.entry='src/TestStore.tsx';
 const compiled=unpackPrerenderBuild((await runLocalQualification('prerender-build',packPrivateBuild(manifest,'http://localhost:4100'))).output);
 const bootstrap={route:{routeId:'home',epoch:1,canonicalPath:'/',params:{},publicDataRevision:'synthetic-1'},catalog:fixtureCatalog,capabilities:['catalog.read'],assets:{}};
 const ssr=(await runLocalQualification('prerender',{javascript:compiled.renderer.javascript,bootstrap})).output as {html:string};
 const base=`http://127.0.0.1:4101/resource/${compiled.client.digest}`;
 const html=createPrivatePrerenderDocument(ssr.html,bootstrap,[{path:'app.js',url:`${base}/app.js`,digest:hash(compiled.client.javascript)},{path:'app.css',url:`${base}/app.css`,digest:hash(compiled.client.css)}]);
 for(const width of [390]){
  const receipt=await runLocalQualification('performance',{mode:'candidate-performance/v1',width,bundle:compiled.client,html,bootstrap,assets:[]});
  results.push({name,width,receipt});console.log(JSON.stringify({name,width,receipt}));
  writeFileSync('.superpowers/sdd/2026-10-27-experience-root/native-visible-shift.json',JSON.stringify({diagnosticOnly:true,main:'de0e4a5f2fab01aa06964293d0c713fbea07ae6b',results},null,2));
 }
}
