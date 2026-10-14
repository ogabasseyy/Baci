import {pathToFileURL} from 'node:url';
import {createCartEventWorkerClient} from '@/lib/cart/event-worker-client';
import {publishCartEvents,type CartPublishResult} from '@/lib/cart/event-publisher';

interface WorkerOptions {
 env?:Partial<NodeJS.ProcessEnv>;
 run?:()=>Promise<CartPublishResult>;
 logger?:{info:(message:string,metrics:Record<string,number>)=>void;error:(message:string)=>void};
}
/** Disabled by default. This script never falls back to a service-role client. */
export async function runCartEventsOnce({env=process.env,run,logger=console}:WorkerOptions={}):Promise<number>{
 if(env.COMMERCE_CART_EVENTS_ENABLED!=='true')return 0;
 try{
  const result=await (run?.() ?? publishCartEvents(createCartEventWorkerClient(env),'cart-events'));
  if(!result.ok){logger.error('[cart-events] publisher unavailable');return 1;}
  if(result.sent||result.failed)logger.info('[cart-events] batch',{sent:result.sent,failed:result.failed,deadLettered:result.deadLettered});
  return 0;
 }catch{logger.error('[cart-events] publisher unavailable');return 1;}
}
async function main():Promise<void>{
 await import('dotenv/config');
 const args=process.argv.slice(2);
 if(args.length>1||args.some(arg=>!['--once','--loop'].includes(arg))){console.error('[cart-events] use --once or --loop');process.exitCode=1;return;}
 const loop=args.includes('--loop');let stopped=false;
 const stop=()=>{stopped=true;};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 do{
  const status=await runCartEventsOnce();
  if(status!==0){process.exitCode=status;break;}
  if(loop&&!stopped)await new Promise(resolve=>setTimeout(resolve,1000));
 }while(loop&&!stopped);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){void main().catch(()=>{console.error('[cart-events] startup failed');process.exitCode=1;});}
