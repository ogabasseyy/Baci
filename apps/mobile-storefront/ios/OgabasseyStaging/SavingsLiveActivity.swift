import ActivityKit
import Foundation
import React

@objc(SavingsLiveActivity)
class SavingsLiveActivity: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(sync:title:saved:target:)
  func sync(_ goalId: String, title: String, saved: Double, target: Double) {
    Task { @MainActor in
      for activity in Activity<SavingsAttributes>.activities where activity.attributes.goalId == goalId {
        guard saved.isFinite, target.isFinite, saved >= 0, target > 0 else { return }
        var state = activity.content.state
        state.saved = saved
        state.target = target
        state.updatedAt = Date()
        await activity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(900)))
      }
    }
  }

  @objc(track:title:saved:target:phase:)
  func track(_ goalId: String, title: String, saved: Double, target: Double, phase: String) {
    guard Bundle.main.bundleIdentifier == "com.ogabassey.staging", UUID(uuidString: goalId) != nil,
      saved.isFinite, target.isFinite, saved >= 0, target > 0,
      ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    Task { @MainActor in
      guard ["pending", "confirmed", "cancelled", "unknown"].contains(phase) else { return }
      let existing = Activity<SavingsAttributes>.activities.first(where: { $0.attributes.goalId == goalId })
      let state = SavingsAttributes.ContentState(saved: saved, target: target, updatedAt: Date(), phase: phase)
      let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(900))
      for activity in Activity<SavingsAttributes>.activities where activity.attributes.goalId != goalId {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      if let activity = existing {
        if phase == "confirmed" || phase == "cancelled" {
          await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(60)))
        } else {
          await activity.update(content)
        }
      } else {
        guard phase == "pending" else { return }
        do {
          _ = try Activity.request(attributes: SavingsAttributes(goalId: goalId, title: String(title.prefix(100)), sandbox: true), content: content, pushType: nil)
        } catch {
          NSLog("Savings Live Activity unavailable")
        }
      }
    }
  }

  @objc func clear() {
    Task {
      for activity in Activity<SavingsAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
