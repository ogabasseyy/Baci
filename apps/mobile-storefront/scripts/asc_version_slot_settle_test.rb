# frozen_string_literal: true

# Behavioral coverage for wait_for_settled_review_submission: executes the REAL
# waiter from asc_version_slot.rb against a scripted ReviewSubmission API
# (states, transient errors, timeouts, blocked fetches) instead of matching
# its source text. Sleep is stubbed so exhaustion runs all 40 iterations
# instantly; the monotonic deadline and Timeout bounding stay real.
require 'minitest/autorun'

module Kernel
  def sleep(*); 0; end
end

module Spaceship
  class TooManyRequestsError < StandardError; end
  class AppleTimeoutError < StandardError; end
  class InternalServerError < StandardError; end
  class BadGatewayError < StandardError; end
  class GatewayTimeoutError < StandardError; end

  module ConnectAPI
    module ReviewSubmission
      @script = []
      @calls = 0

      class << self
        attr_reader :calls

        def script=(steps)
          @script = steps
          @calls = 0
        end

        def get(review_submission_id:)
          step = @script[@calls]
          @calls += 1
          raise step if step.is_a?(Class)

          state = step.is_a?(Proc) ? step.call : step
          Struct.new(:state).new(state)
        end
      end
    end
  end
end

module Faraday
  class ConnectionFailed < StandardError; end
  class TimeoutError < StandardError; end
end

load File.expand_path('../fastlane/asc_version_slot.rb', __dir__)

class SettleWaitBehaviorTest < Minitest::Test
  def review_submission
    Spaceship::ConnectAPI::ReviewSubmission
  end

  def test_settles_once_the_submission_leaves_active_states
    review_submission.script = %w[CANCELING COMPLETING ACCEPTED]

    assert wait_for_settled_review_submission('sub-1')
    assert_equal 3, review_submission.calls
  end

  def test_exhaustion_fails_closed
    review_submission.script = ['CANCELING'] * EDITABLE_VERSION_POLL_ATTEMPTS

    refute wait_for_settled_review_submission('sub-2')
    assert_equal EDITABLE_VERSION_POLL_ATTEMPTS, review_submission.calls
  end

  def test_transient_fetch_failures_retry
    review_submission.script = [
      Spaceship::TooManyRequestsError,
      Faraday::ConnectionFailed,
      'ACCEPTED'
    ]

    assert wait_for_settled_review_submission('sub-3')
    assert_equal 3, review_submission.calls
  end

  def test_fetch_timeout_fails_closed
    review_submission.script = [Timeout::Error]

    refute wait_for_settled_review_submission('sub-4')
  end

  def test_slow_fetch_that_recovers_still_settles
    review_submission.script = [
      -> { IO.select(nil, nil, nil, 0.2); 'CANCELING' },
      'ACCEPTED'
    ]

    assert wait_for_settled_review_submission('sub-5')
    assert_equal 2, review_submission.calls
  end

  def test_blocked_fetch_past_deadline_fails_closed
    # The production deadline is 600s; shrink it for this test only so a
    # truly blocked fetch fails closed in ~1s instead of ~10 minutes.
    # Restored in ensure so randomized ordering cannot leak the override.
    original = REVIEW_SETTLE_TIMEOUT_SECONDS
    Object.send(:remove_const, :REVIEW_SETTLE_TIMEOUT_SECONDS)
    Object.const_set(:REVIEW_SETTLE_TIMEOUT_SECONDS, 1)
    review_submission.script = [-> { Queue.new.pop }]

    refute wait_for_settled_review_submission('sub-6')
    assert_equal 1, review_submission.calls
  ensure
    Object.send(:remove_const, :REVIEW_SETTLE_TIMEOUT_SECONDS)
    Object.const_set(:REVIEW_SETTLE_TIMEOUT_SECONDS, original)
  end
end
