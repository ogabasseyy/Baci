# Naira down-payment controls

Implemented locally in the transferred checkout. No deployment, cancellation or approval was performed. One additional six-month staging booking was explicitly tested through the new tab interaction. Activation and settlement remain disabled.

- Primary naira input, percentage readout, decimal slider and horizontal 5% choices share one selection. Confirmed decimal percentages also appear among the tap choices.
- Down-payment rounding uses integer kobo and Oxygen’s maximum two-decimal percentage precision. On blur, amounts that cannot be represented exactly are normalized and the adjustment is announced. Empty, malformed and out-of-range money never selects a confirmed plan or submits a booking.
- Exact percentage/tenure cache matches reuse their saved reference. Uncached choices show only down payment and financed balance, labeled not yet quoted; previous fees, repayment schedule and reference are removed. Typing and slider movement only update the local preview. Committing the amount, releasing the slider or selecting an uncached percentage/tenure requests a confirmed breakdown. Cached choices never book again.
- Repayment periods use compact native radio controls styled as tabs, with keyboard navigation and all eligible tenures (up to the existing 12-month integration limit). Initial applications use the same control. Uncached tenure selection requests a new breakdown and saves it; no speculative prefetching occurs.
- The dialog retains an accessible screen-reader name and description but removes the repeated visible generic application banner. Each step’s own heading provides the visible context, with the close control preserved.
- Approved loans retain their actual fixed breakdown and do not expose this comparison control.

Live actual checkout verified: typing 118800 switches to the saved 30% reference; typing 150000 normalizes to 150004.80 at 37.88%, with an explicit adjustment notice and no stale schedule. Returning to 37.25% restores the confirmed reference. Final screenshot: transfer parent / naira-downpayment-popup.png.

Regression coverage includes money rounding/bounds, blank/invalid input, synchronization, cached reference reuse, hiding stale fees, approved-loan isolation, accessible dialog close/reopen and tenure selection. Original staged patch preserved byte-for-byte. No unrelated working changes reverted.

CodeRabbit component-scope review completed with three minor findings and no major/critical findings. The dialog resume button now uses the shared theme class. Existing provider-session error handling and employment-field defaults are outside this UI task and remain for separate follow-up. The final banner/tab layout was subsequently verified in the actual checkout, with targeted tests and typechecks passing.

## Eligible-month quotes

`POST /api/payments/oxygen/plans/quote` authenticates the customer, checks CSRF, limits/bounds input and executes through the existing normal worker and durable runtime ledger. It does not use an admin/service-role client or a new database migration. Exact product-amount, percentage and tenure matches return the existing cached reference. The public saved-plans RPC rechecks order ownership and current amount.

On a cache miss, one `book` command runs, followed by `refresh_details`. Booking on an existing BOOKED state requires completed eligibility/KYC, changed terms, no active approval OTP/payment, and no reconciliation hold/block/pending command. The command ledger’s unique pending-workflow index prevents concurrent execution. Failure after response loss remains indeterminate and cannot be repeated. If the booking is confirmed but details are absent, retry executes only the details read. Old charges and schedules are removed before the new booking is persisted, preventing a mixed-plan cache entry.

The quote provider allowlist permits only `book` and `details`. No approval OTP, approval, cancellation, activation or settlement is invoked. Cached comparison remains separate from approval routing. The UI disables controls during an in-flight request, sends no automatic retry, and waits for older preference writes before requesting another quote. It only publishes a validated complete cached plan.

Live staging evidence: 37.25% / 6 months reference `c28740bc-fdd9-4d4a-8614-4e66153866d0`, principal NGN248490, charges NGN4907.68; five installments NGN51730 and final NGN51733.45, November 2026 through April 2027. Switching 6→3→6 reused the original references. Durable book-command count increased from 1 to 2 for the single uncached six-month test, and did not increase on cached switching. The older indeterminate-command fingerprint remained `2e848d0cb8791833b43387b65ea541f8`. No cancellation/approval command exists in this fresh workflow audit. Activation/settlement remain false.

Affected provider/API/UI suite passed 965 tests across 81 files; an additional preference/quote ordering regression passed in the five-test hook suite after the broader run. Web and tools typechecks passed. API-scope CodeRabbit review completed cleanly; component/provider review receipts are retained privately and any pre-existing findings are separate from these changes.

## Compact summary refinement

New applications default to 25%; existing saved choices are retained on resume. The editable naira field now has a visible border and Edit focus control. The comparison summary leads with Pay now and Monthly repayment, and keeps itemized fees/dates/reference collapsed. Loading removes all prior summary figures and renders reduced-motion-aware skeletons in their places. No fake schedule/fees are calculated locally. A sticky Review plan action expands local review only; it never triggers approval.

Verified in the actual popup: changing to 25% at six months made one explicit staging booking, saved as reference `438f96ee-37c4-49bb-a56c-51451f9cb624`. Upfront NGN104865.75, five monthly repayments NGN61829 and final NGN61830.89. Screenshot evidence records both figure-only loading and the final compact summary. Review/back actions made no provider call. Protected old-command fingerprint remained unchanged. No cancellation/approval command was recorded.

Oxygen’s published API exposes monthly repayments and no daily/weekly frequency selection; no such UI choices were added.

Summary-specific regression coverage verifies no currency figures survive a loading transition, fees and dates start collapsed, local Review plan does not call approval, and initial applications default to 25%. The historical 35% journey fixture now explicitly selects 35% before booking rather than depending on the old default. UI refinements made no changes to activation/settlement flags or the old staged patch.
