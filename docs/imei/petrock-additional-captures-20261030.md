# Additional Petrock capture disposition — 2026-10-30

The release operator observed terminal success for the owner's single paid
product **716** and **1966** probes. This parser follow-up placed no orders.
Sanitized captured fixtures omit IMEI/IMEI2, serial, order, reference and transport
credentials; the unneeded purchase-date line is also omitted from product 716.

| Product | Captured output | Coverage disposition |
| --- | --- | --- |
| 716 | Device model, serial, purchase date, limited warranty, `SIMLock Status: Unlocked` | Add the exact SIMLock Status parser alias. No model-number field or explicit vendor model-code token was returned. The unchanged-price SIM-lock tier now promises device model and SIM-lock status only; those fields are captured. Hardware model-number and broader device/input coverage are not claimed. |
| 1966 | Device model, `Replacement Device: No` | A replacement-device flag is not a replacement-history report. Neither modelNumber nor replacementHistory is established. Keep the new `replacementStatus` tier dark and its fixture gate false. |

The original model strings contain no `APPLE_A####_` token, so neither response
gets an invented model number. Sanitized regression tests enforce these missing
fields, reject upgrading the replacement capture to verified tier coverage, and
retain unknown blacklist status for the SIM-lock report. No customer price,
supplier baseline, rollout flag or production state changed in this follow-up.
The SIM-lock advertised field list is narrowed to its actual core output, without
removing a provider-returned hardware model number when one is available.
