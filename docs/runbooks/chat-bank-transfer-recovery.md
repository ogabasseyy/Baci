# Release an abandoned chat bank-transfer attempt

A pending chat bank-transfer attempt blocks a new account request while the first request's outcome is uncertain. An app outage can produce a separate temporarily unavailable response.

1. In the affected environment, use the order ID to look up the current reference and claim time in `private.chat_paystack_dva_attempts`. Keep those identifiers in the internal incident record.
2. Confirm that the original initialization request has ended. Ask Paystack to check the merchant subaccount, Paystack customer, and attempt time for an account assignment or payment. The BAC reference identifies the local claim. The account request sent to Paystack uses the customer and subaccount. Get confirmation that the attempt produced neither an assignment nor a payment, and record it in the incident. If the outcome is still uncertain or Paystack confirms an assignment or payment, leave the claim in place and reconcile with Paystack.
3. After 15 minutes, a database operator can use the verified order ID and exact reference:

   ```sql
   SELECT private.release_unfulfilled_chat_paystack_dva_attempt(
     '<confirmed order UUID>'::uuid, '<confirmed BAC reference>'
   );
   ```

4. A `true` result allows the same order to try bank transfer again. A `false` result means the database left the claim intact. Check the current reference, claim age, order status, saved assignment, and transactions before taking further action.
