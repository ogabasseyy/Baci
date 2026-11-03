# Apple part-number diagnostic — 2026-10-30

The release operator's owner-authorized product **1963** probe reached terminal
`success`. Its captured output was:

- `Part Number: MFYC4J/A`
- `Part Number Country: Japan`
- `Part Type: Retail Unit`

The sanitized fixture is
`apps/web/src/lib/imei-providers/petrock/fixtures/petrock-part-number-1963-20261030.json`.
It omits the IMEI line and all order/reference/transport credentials. No device
name, model number, blacklist status or purchase-safety finding was returned.

The **Apple Part Number** tier now promises only its core **Part Number** field.
Its existing customer price remains **₦700**; the supplier baseline is corrected
to the catalog/probe's **US$0.12**. Product **1963**, machine field `IMEI`, is bound
only to the Apple smartphone IMEI scope. Tablet, laptop, watch and serial-input
coverage are not approved. A missing explicit smartphone category, disabled
global flag, absent tier allowlist or missing async capability blocks the binding.

The public tier remains subject to server runtime availability in both clients.
No device/model values are invented: the provider response retains an empty model
number, unknown device identity, an empty device-image URL for the existing phone
icon fallback, and unknown/caution safety state. Both clients already support the
optional neutral Part Number card; absent identity is not a rendering prerequisite.

This corrects the advertised diagnostic contract to the observed field rather
than claiming model/device-family coverage. The remaining **20** info-tier
candidates stay unverified and dark (13 catalog matches and seven unmatched).
The offline review harness continues to use a still-dark candidate and never
promotes synthetic examples to captured evidence. Root-owned append-only SQL
activation requires `20261030120000_imei_authenticated_access_boundary.sql`
followed by `20261030120001_imei_verified_diagnostic_prices.sql` before
allowlisting or application publication. It admits the unchanged ₦700 retail price.

Regression tests cover exact captured parsing, missing identity/safety fields,
provider completion with the existing icon fallback, all runtime/configuration
gates, the scoped catalog record and the unchanged customer price. This patch
does not create orders automatically. The operator's paid probe above changed
neither a customer wallet nor production configuration.
