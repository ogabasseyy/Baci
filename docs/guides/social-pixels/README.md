# TikTok and Snapchat Pixel/CAPI setup in Baci

Repeat these steps separately for each merchant. A platform account's saved
connection does not connect every Baci store to that account.

## Save the existing website data source

1. Sign in to the merchant's TikTok Ads Manager or Snapchat Ads Manager.
2. Open Events Manager and select the website Pixel already associated with the
   merchant's catalog. Check its name, recent activity, and catalog connection.
3. Copy its Pixel ID. In Baci, open **Dashboard → Integrations → TikTok** or
   **Snapchat**, then paste that ID.
4. Use the platform's Events API/Conversions API setup to obtain its server
   credential, and save it directly in the corresponding Baci integration.
   Keep the credential out of messages, screenshots, and shared documents.
5. Reopen the Baci integration to confirm the ID and masked saved credential.

Baci uses the merchant's own Pixel ID in its storefront. Provider credentials
remain on the server; a visitor request never needs permission to read them.

## Test browser and server events

1. Select the same Pixel in the provider's test-events screen.
2. Open the merchant's product page directly in a new tab.
3. Choose **Necessary only**. Visiting the page or opening the cart must not
   send Facebook/TikTok/Snapchat marketing events. Facebook measurement requires
   analytics consent; TikTok and Snapchat require marketing consent.
4. Use the storefront consent controls to grant marketing consent.
5. View a product, add one temporary item, and move through checkout only as far
   as needed to inspect the event. Do not create an order or payment merely to
   test these observations.
6. Confirm browser requests use the selected merchant's Pixel ID, catalog
   product IDs, and actual currency and value.
7. Check the normal Baci event request and its queue receipt. A queued response
   is acceptance by Baci; it is not proof that the provider received an event.
8. With delivery enabled for the merchant and destination, match the queued
   event to a successful worker/provider receipt and the provider's event view.
9. Remove only the temporary item added for the test and restore the prior cart.

On a direct landing, the pixels mount in the persistent storefront shell.
Events wait for that pixel's normal bootstrap rather than being lost before its
SDK queue exists. A merchant change clears ownership of the old Pixel. A later
consent revocation blocks further event calls even if the SDK remains loaded.

## Event identities

TikTok uses the same `event_id` for the browser Pixel event and Events API event.
Snapchat uses browser `client_dedup_id` matching server `event_id`. Check both
the event name and identity when assessing deduplication. Do not substitute an
order number or a different generated ID on one side of an observation pair.

- [TikTok event deduplication](https://ads.tiktok.com/help/article/event-deduplication?lang=en)
- [Snapchat event deduplication](https://developers.snap.com/marketing-api/Conversions-API/Deduplication)

## Successful-payment conversion

Confirmed payments use Baci's existing paid-order conversion pipeline. The
public visitor endpoints accept only product, add-to-cart, and checkout-start
observations; they reject client-supplied purchases. Test Purchase separately
with an approved controlled payment and verify the paid order, stable event
identity, worker receipt, and provider receipt. Browser setup alone does not
prove that paid-order delivery is active.

## Screenshot checklist

Capture the selected website Pixel and catalog association, Baci's saved ID and
masked credential, storefront consent choice, the normal temporary cart action,
and provider browser/server receipts. Capture event names, currency/value, and
matching event IDs where available. Do not include a visible server credential
or customer personal information. Label missing receipts as pending rather than
presenting the setup screen as delivery proof.
