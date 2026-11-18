# Ogabassey Black Friday 2026

The campaign date is Friday, 27 November 2026. The web storefront and native
app share the approved lineup in `apps/web/src/config/ogabassey-black-friday.ts`.
Development previews can use sample products when the approved list is empty.

- Before launch, enter the approved product slugs in display order and verify
  the lineup on web and native. Confirm the sales end time with the campaign
  owner and schedule the removal deploy for that time in Africa/Lagos.
- When the sale ends, deploy an empty approved lineup. The API should return
  an empty product list. The web and native home campaign entries should
  disappear, and the canonical campaign page should return to noindex.
- Verify after the app's cached data refreshes. On a refresh failure, the app
  keeps the last loaded lineup and offers a retry.
