import {expect,it,vi} from 'vitest';
import {runCartEventsOnce} from './process-cart-events';
it('is disabled without explicit worker activation and never loads a credential',async()=>{
 const run=vi.fn();expect(await runCartEventsOnce({env:{},run})).toBe(0);expect(run).not.toHaveBeenCalled();
});
it('reports only bounded publisher metrics and fails safely on outages',async()=>{
 const info=vi.fn();const error=vi.fn();
 expect(await runCartEventsOnce({env:{COMMERCE_CART_EVENTS_ENABLED:'true'},run:async()=>({ok:true,sent:1,failed:0,deadLettered:0}),logger:{info,error}})).toBe(0);
 expect(info).toHaveBeenCalledWith('[cart-events] batch',{sent:1,failed:0,deadLettered:0});
 expect(await runCartEventsOnce({env:{COMMERCE_CART_EVENTS_ENABLED:'true'},run:async()=>{throw new Error('private credential detail')},logger:{info,error}})).toBe(1);
 expect(error).toHaveBeenCalledWith('[cart-events] publisher unavailable');
});
