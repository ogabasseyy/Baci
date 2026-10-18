import Foundation
import Sentry

var failures = 0
func check(_ value: Bool, _ name: String) {
  print("\(value ? "PASS" : "FAIL") \(name)")
  if !value { failures += 1 }
}

let options = Options()
var upstreamCalls = 0
options.beforeBreadcrumb = { breadcrumb in
  upstreamCalls += 1
  return breadcrumb.category == "upstream-denied" ? nil : breadcrumb
}
let originalHangSetting = options.enableAppHangTracking
configureBaciSentryDiagnostics(options)
check(options.enableMetricKit, "MetricKit diagnostics are enabled")
check(!options.enableMetricKitRawPayload, "raw MetricKit attachments remain disabled")
check(options.enableAppHangTracking == originalHangSetting && originalHangSetting,
      "existing app hang tracking stays enabled")
for category in ["http", "fetch", "xhr", " HTTP "] {
  let breadcrumb = Breadcrumb(level: .info, category: category)
  breadcrumb.data = ["url": "https://example.invalid/private-capability?address=private"]
  check(options.beforeBreadcrumb?(breadcrumb) == nil, "drops native network category \(category)")
}
let typed = Breadcrumb(level: .info, category: "custom-request")
typed.type = "http"
check(options.beforeBreadcrumb?(typed) == nil, "drops HTTP type independently of category")
check(upstreamCalls == 0, "network data never reaches a downstream callback")
for category in ["navigation", "app.diagnostics", "performance.surface", "ui.lifecycle", "device.event", "app.memory"] {
  let breadcrumb = Breadcrumb(level: .info, category: category)
  breadcrumb.data = ["focused": true]
  check(options.beforeBreadcrumb?(breadcrumb) === breadcrumb, "preserves \(category) breadcrumb identity")
}
check(options.beforeBreadcrumb?(Breadcrumb(level: .info, category: "upstream-denied")) == nil,
      "preserves an existing native callback's rejection")

// Exercise the actual Cocoa SDK pipeline without external transport. beforeSend
// consumes the test event locally; no account, user data or real DSN is used.
options.dsn = "http://public@127.0.0.1:9/1"
options.cacheDirectoryPath = ProcessInfo.processInfo.environment["BACI_NATIVE_PROBE_CACHE"]!
options.enableAutoSessionTracking = false
options.sendDefaultPii = false
var inspected = false
options.beforeSend = { event in
  inspected = true
  check(event.breadcrumbs?.contains(where: { $0.category == "navigation" }) == true,
        "native SDK retains route breadcrumbs")
  check(event.breadcrumbs?.contains(where: { $0.category == "app.memory" }) == true,
        "request bursts cannot evict earlier memory warnings")
  check(event.breadcrumbs?.contains(where: { $0.category == "http" }) == false,
        "native SDK filters HTTP before capture")
  let integrations = event.sdk?["integrations"] as? [String] ?? []
  check(integrations.contains("MetricKit"), "native SDK installs MetricKit integration")
  check(integrations.contains("ANRTracking"), "native SDK keeps existing hang integration")
  return nil
}
SentrySDK.start(options: options)
SentrySDK.addBreadcrumb(Breadcrumb(level: .info, category: "navigation"))
SentrySDK.addBreadcrumb(Breadcrumb(level: .warning, category: "app.memory"))
for _ in 0..<150 {
  let request = Breadcrumb(level: .info, category: "http")
  request.data = ["url": "https://example.invalid/private-capability?address=private"]
  SentrySDK.addBreadcrumb(request)
}
SentrySDK.capture(message: "local native diagnostics regression")
check(inspected, "test event traverses native beforeSend")
SentrySDK.close()
exit(failures == 0 ? 0 : 1)
