import { fixtureManifest } from './fixtures/qualification-fixtures';
export function checkpointBFixture(name: string) {
  const manifest = fixtureManifest(name);
  manifest.entry = 'src/checkpoint-b-entry.tsx';
  manifest.packages.push(
    { name: 'react-dom', versionRef: 'platform-pinned' },
    { name: '@baci/experience-sdk', versionRef: 'platform-pinned' }
  );
  manifest.files.find(
    (f) => f.path === 'src/qualification-commerce.tsx'
  )!.content =
    `import {useState} from 'react';import {useCommerce} from '@baci/experience-sdk';export function useQualificationCommerce(){const api=useCommerce();const[count,setCount]=useState(0);return {count,add:()=>{void api.cart.add({productId:'synthetic-device',variantId:'silver',quantity:1}).then(r=>{if(r.status==='ok')setCount(r.value.lines.reduce((n,l)=>n+l.quantity,0))})},navigate:path=>void api.navigation.go(path)}}`;
  manifest.files.push({
    path: manifest.entry,
    content: `import {useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import {connectExperience,CommerceProvider,Link} from '@baci/experience-sdk';import Experience from './Experience';const bridge=connectExperience('http://127.0.0.1:4100');bridge.ready.then(bootstrap=>{function App(){const[route,setRoute]=useState(bootstrap.route);useEffect(()=>bridge.onRoute(setRoute),[]);return <CommerceProvider commerce={bridge.commerce}><Experience route={route} catalog={bootstrap.catalog}/><Link path="/products/device" newContext>Request trusted product link</Link></CommerceProvider>}createRoot(document.getElementById('root')).render(<App/>)});`,
  });
  return manifest;
}
