import ActivityKit
import Foundation

struct SavingsAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var saved: Double
    var target: Double
    var updatedAt: Date
    var phase: String
  }
  var goalId: String
  var title: String
  var sandbox: Bool
  var progressURL: URL {
    var components = URLComponents(string: "com.ogabassey.staging://wallet")!
    components.queryItems = [URLQueryItem(name: "action", value: "savings"), URLQueryItem(name: "savingsGoalId", value: goalId)]
    return components.url!
  }
}
