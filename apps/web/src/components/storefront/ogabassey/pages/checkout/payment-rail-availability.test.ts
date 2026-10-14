import {expect,it} from 'vitest';
import {checkoutPaymentRails} from './payment-rail-availability';
it('never offers NGN-only rails for a USD checkout',()=>{
 const result=checkoutPaymentRails(null,'USD');
 expect(result.paystackCheckoutAvailable).toBe(false);
 expect(result.bankTransferCheckoutAvailable).toBe(false);
});
