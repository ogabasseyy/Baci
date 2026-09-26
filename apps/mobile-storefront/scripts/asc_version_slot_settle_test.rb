# frozen_string_literal: true

# Behavioral coverage for wait_for_settled_review_submission: executes the REAL
# waiter from asc_version_slot.rb against a scripted ReviewSubmission API
# (states, transient errors, timeouts) instead of matching its source text.
# Sleep is stubbed so exhaustion runs all 40 iterations instantly; the
# monotonic deadline and Timeout bounding stay real.
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

          Struct.new(:state).new(step)
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
end
