# Local phone test

This is the first release prototype, not a production deployment.

## Connect

Use the existing Ogabassey development app on the same Wi-Fi as this Mac.
Scan the phone-test QR artifact from the run's backup directory
(`~/.codex/backups/<run-id>/phone-test-qr.png`).
Metro is at `http://<lan-ip>:8082`; the assistance backend is at
`http://<lan-ip>:3001`. These addresses are valid while this Mac stays on
the current network and the local processes are running.

## Try the experience

1. Tap search from home. Check that one input moves above the keyboard,
   rests at the bottom when closed, stays focused, and preserves the text while the keyboard opens/closes.
2. Search `iphone`. Cards should show names and prices without waiting for
   their images. Try Price, Brand, Condition, and Sort.
3. Select two products for comparison. Tap View comparison on either selected card, then View options.
   Return to search and check that query and filters are preserved.
4. Type `iphone` and keep the keyboard open. After matching results load,
   tap a suggestion directly above the search bar, such as Used iphone.
   It should immediately apply the condition and refresh the products.
5. Close the keyboard: suggestions should disappear. Change the query: old
   suggestions must disappear while the new results load. Try rotation and
   a slow connection.
6. Open a product, choose its real options, and add it to the normal cart.
   Check that the existing checkout opens. No real payment is required.

## Web parity

Open `http://localhost:3001/ogabassey/search?q=iphone` on this Mac.
Check concise filter labels, sorting, comparison, and suggestions while the search field is focused. Mobile web
retains its search header; the keyboard dock is a native app interaction.

## Verification limits

Focused native, web, shared, and regression tests passed. Web typecheck passed;
native typecheck has six existing slide fixture errors. Browser automation
timed out, so visual web verification and actual phone keyboard, rotation,
and accessibility behaviour need a device test. Full repository checks have
additional failures and are not a clean release gate.


## Product request and search header (2026-10-02)

- Open empty search: back arrow and cart icon; no comparison action.
- Search iphone and select two cards: View comparison appears with results.
- Clear search: comparison action hides, selected cards remain saved.
- Search an unavailable product (for example, iPhone 99), then tap Request this product.
- Product is prefilled; enter your own email or phone and explicitly send.
- Success confirms the request. Check the merchant inbox after the next minute.
- App and web zero-match states both have this flow; search errors do not show it.
- Database intake is active. OS push delivery is not part of this change.
- Metro currently uses the Mac LAN IP on port 8082. The older QR may contain a stale IP.
