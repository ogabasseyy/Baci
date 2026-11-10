import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { prerenderRuntimeEntry } from './prerender-runtime-entry';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('generated prerender runtime', () => {
  it('renders the supplied synthetic route into the prerender result envelope', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'baci-prerender-runtime-'));
    tempDirs.push(dir);
    const outfile = path.join(dir, 'runtime.mjs');
    await build({
      stdin: {
        contents: prerenderRuntimeEntry('Experience.tsx'),
        resolveDir: process.cwd(),
        sourcefile: 'generated-prerender.tsx',
        loader: 'tsx',
      },
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      jsx: 'automatic',
      plugins: [
        {
          name: 'safe-prerender-fixture',
          setup(buildApi) {
            buildApi.onResolve(
              {
                filter:
                  /^(react-dom\/server\.browser|react\/jsx-runtime|@baci\/experience-sdk|\.\/Experience\.tsx)$/,
              },
              (args) => ({
                path: args.path,
                namespace: 'fixture',
              })
            );
            buildApi.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
              if (args.path === 'react/jsx-runtime')
                return {
                  contents:
                    'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
                  loader: 'js',
                };
              if (args.path === '@baci/experience-sdk')
                return {
                  contents:
                    'export const CommerceProvider=({children})=>children;export const createCommerceClient=()=>async()=>({status:"error"});',
                  loader: 'js',
                };
              if (args.path === './Experience.tsx')
                return {
                  contents:
                    'export default function Experience({route}){return <main>{route.canonicalPath}</main>}',
                  loader: 'tsx',
                };
              return {
                contents: `const render=(node)=>{if(node==null||typeof node==="boolean")return "";if(typeof node==="string"||typeof node==="number")return String(node);if(Array.isArray(node))return node.map(render).join("");if(typeof node.type==="function")return render(node.type(node.props));const children=render(node.props?.children);return "<"+node.type+">"+children+"</"+node.type+">"};export async function renderToReadableStream(node){const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(render(node)));controller.close()}});stream.allReady=Promise.resolve();return stream}`,
                loader: 'js',
              };
            });
          },
        },
      ],
      logLevel: 'silent',
    });

    const script = `const {prerender}=await import(${JSON.stringify(pathToFileURL(outfile).href)});const result=await prerender({assets:{},route:{canonicalPath:"/products/synthetic"},catalog:{products:[]}});process.stdout.write(JSON.stringify(result));`;
    const stdout = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      }
    );
    expect(JSON.parse(stdout)).toEqual({
      format: 'baci-prerender/v1',
      html: '<main>/products/synthetic</main>',
    });
  });
});
