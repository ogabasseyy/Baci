import ActivityKit
import Foundation
import React

@objc(SavingsLiveActivity)
class SavingsLiveActivity: NSObject {
  private enum Operation {
    case sync(generation: UInt64, goalId: String, saved: Double, target: Double)
    case track(generation: UInt64, goalId: String, title: String, saved: Double, target: Double, phase: String)
    case clear(generation: UInt64)
  }

  private let queueLock = NSLock()
  private var operations: [Operation] = []
  private var generation: UInt64 = 0
  private var isDraining = false

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(sync:title:saved:target:)
  func sync(_ goalId: String, title: String, saved: Double, target: Double) {
    let operationGeneration = currentGeneration()
    enqueue(.sync(generation: operationGeneration, goalId: goalId, saved: saved, target: target))
  }

  @objc(track:title:saved:target:phase:)
  func track(_ goalId: String, title: String, saved: Double, target: Double, phase: String) {
    let operationGeneration = currentGeneration()
    guard Bundle.main.bundleIdentifier == "com.ogabassey.staging", UUID(uuidString: goalId) != nil,
      saved.isFinite, target.isFinite, saved >= 0, target > 0,
      ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    enqueue(.track(generation: operationGeneration, goalId: goalId, title: title, saved: saved, target: target, phase: phase))
  }

  @objc func clear() {
    queueLock.lock()
    generation &+= 1
    let clearGeneration = generation
    operations.append(.clear(generation: clearGeneration))
    let shouldStartDrain = !isDraining
    isDraining = true
    queueLock.unlock()

    if shouldStartDrain {
      Task { @MainActor in await drain() }
    }
  }

  private func currentGeneration() -> UInt64 {
    queueLock.lock()
    defer { queueLock.unlock() }
    return generation
  }

  private func enqueue(_ operation: Operation) {
    queueLock.lock()
    operations.append(operation)
    let shouldStartDrain = !isDraining
    isDraining = true
    queueLock.unlock()

    if shouldStartDrain {
      Task { @MainActor in await drain() }
    }
  }

  @MainActor
  private func drain() async {
    while let operation = dequeue() {
      switch operation {
      case let .sync(operationGeneration, goalId, saved, target):
        await syncActivities(generation: operationGeneration, goalId: goalId, saved: saved, target: target)
      case let .track(operationGeneration, goalId, title, saved, target, phase):
        await trackActivity(generation: operationGeneration, goalId: goalId, title: title, saved: saved, target: target, phase: phase)
      case let .clear(operationGeneration):
        await clearActivities(generation: operationGeneration)
      }
    }
  }

  private func dequeue() -> Operation? {
    queueLock.lock()
    defer { queueLock.unlock() }
    guard !operations.isEmpty else {
      isDraining = false
      return nil
    }
    return operations.removeFirst()
  }

  @MainActor
  private func syncActivities(generation operationGeneration: UInt64, goalId: String, saved: Double, target: Double) async {
    guard isCurrent(operationGeneration), saved.isFinite, target.isFinite, saved >= 0, target > 0 else { return }
    for activity in Activity<SavingsAttributes>.activities where activity.attributes.goalId == goalId {
      guard isCurrent(operationGeneration) else { return }
      var state = activity.content.state
      state.saved = saved
      state.target = target
      state.updatedAt = Date()
      await activity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(900)))
      guard isCurrent(operationGeneration) else { return }
    }
  }

  @MainActor
  private func trackActivity(generation operationGeneration: UInt64, goalId: String, title: String, saved: Double, target: Double, phase: String) async {
    guard isCurrent(operationGeneration), ["pending", "confirmed", "cancelled", "unknown"].contains(phase) else { return }
    let state = SavingsAttributes.ContentState(saved: saved, target: target, updatedAt: Date(), phase: phase)
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(900))
    for activity in Activity<SavingsAttributes>.activities where activity.attributes.goalId != goalId {
      guard isCurrent(operationGeneration) else { return }
      await activity.end(nil, dismissalPolicy: .immediate)
      guard isCurrent(operationGeneration) else { return }
    }

    guard isCurrent(operationGeneration) else { return }
    if let activity = Activity<SavingsAttributes>.activities.first(where: { $0.attributes.goalId == goalId }) {
      if phase == "confirmed" || phase == "cancelled" {
        await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(60)))
      } else {
        await activity.update(content)
      }
      return
    }

    guard isCurrent(operationGeneration), phase == "pending" else { return }
    do {
      // Keep creation atomic with respect to clear()'s generation advance.
      try performIfCurrent(operationGeneration) {
        _ = try Activity.request(attributes: SavingsAttributes(goalId: goalId, title: String(title.prefix(100)), sandbox: true), content: content, pushType: nil)
      }
    } catch is StaleGenerationError {
      return
    } catch {
      NSLog("Savings Live Activity unavailable")
    }
  }

  @MainActor
  private func clearActivities(generation operationGeneration: UInt64) async {
    for activity in Activity<SavingsAttributes>.activities {
      guard isCurrent(operationGeneration) else { return }
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }

  private func isCurrent(_ operationGeneration: UInt64) -> Bool {
    queueLock.lock()
    defer { queueLock.unlock() }
    return generation == operationGeneration
  }

  private func performIfCurrent(_ operationGeneration: UInt64, action: () throws -> Void) throws {
    queueLock.lock()
    defer { queueLock.unlock() }
    guard generation == operationGeneration else { throw StaleGenerationError() }
    try action()
  }

  private struct StaleGenerationError: Error {}
}
