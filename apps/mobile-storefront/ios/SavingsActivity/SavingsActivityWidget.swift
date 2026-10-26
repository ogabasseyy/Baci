import ActivityKit
import SwiftUI
import WidgetKit

@main
struct SavingsActivityWidget: Widget {
  private let accent = Color(red: 0.88, green: 0.12, blue: 0.15)
  private func status(_ phase: String) -> String {
    switch phase {
    case "confirmed": return "Contribution confirmed 🎉"
    case "cancelled": return "Contribution cancelled"
    case "unknown": return "Checking transfer — open app for status"
    default: return "Moving money into your savings"
    }
  }
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: SavingsAttributes.self) { context in
      VStack(alignment: .leading, spacing: 12) {
        HStack {
          Label("Ogabassey", systemImage: "wallet.bifold.fill").font(.headline)
          Spacer()
          if context.attributes.sandbox { Text("SANDBOX").font(.caption2).foregroundStyle(.gray) }
        }
        Text(context.attributes.title).font(.subheadline).lineLimit(2)
        HStack(alignment: .firstTextBaseline) {
          Text(context.state.saved, format: .currency(code: "NGN")).font(.title2.bold())
          Spacer()
          Text("of \(context.state.target.formatted(.currency(code: "NGN")))").font(.caption).foregroundStyle(.gray)
        }
        ProgressView(value: min(max(context.state.saved, 0), context.state.target), total: max(context.state.target, 1)).tint(accent)
        Text(context.isStale ? "Open app to refresh progress" : status(context.state.phase)).font(.caption).foregroundStyle(.gray)
      }
      .foregroundStyle(.white).padding(16)
      .activityBackgroundTint(.black)
      .activitySystemActionForegroundColor(.white)
      .widgetURL(context.attributes.progressURL)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { Image(systemName: "wallet.bifold.fill").foregroundStyle(accent) }
        DynamicIslandExpandedRegion(.trailing) { Text(context.state.saved, format: .currency(code: "NGN")).font(.caption.bold()) }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading) {
            Text(context.attributes.title).lineLimit(1)
            ProgressView(value: min(max(context.state.saved, 0), context.state.target), total: max(context.state.target, 1)).tint(accent)
          }
        }
      } compactLeading: { Image(systemName: "wallet.bifold.fill").foregroundStyle(accent) }
        compactTrailing: { Text("Save").font(.caption2) }
        minimal: { Image(systemName: "wallet.bifold.fill").foregroundStyle(accent) }
        .widgetURL(context.attributes.progressURL)
        .keylineTint(accent)
    }
  }
}
