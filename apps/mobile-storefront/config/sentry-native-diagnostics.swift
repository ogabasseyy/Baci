import Sentry

func configureBaciSentryDiagnostics(_ options: Options) {
  // Keep the existing hang detector while collecting independent OS evidence.
  options.enableMetricKit = true
  options.enableMetricKitRawPayload = false

  let previous = options.beforeBreadcrumb
  options.beforeBreadcrumb = { breadcrumb in
    let category = breadcrumb.category.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let type = breadcrumb.type?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    // Native HTTP breadcrumbs bypass JS beforeBreadcrumb. Drop requests before
    // they reach the bounded store or any existing callback: URLs may carry
    // receipt capabilities or private address/session queries.
    if ["http", "fetch", "xhr"].contains(category) || type == "http" {
      return nil
    }
    if let previous { return previous(breadcrumb) }
    return breadcrumb
  }
}
