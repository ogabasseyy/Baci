# frozen_string_literal: true

# Guards asc_version_slot.rb against load-time NameErrors: the file is imported
# at the top of the Fastfile, so every top-level constant reference must
# resolve before any lane runs. Spaceship itself is stubbed here — only the
# referenced constants need to exist for the load check; their real
# definitions live in the pinned fastlane gem (spaceship/errors.rb).
require 'minitest/autorun'

module Spaceship
  class TooManyRequestsError < StandardError; end
  class AppleTimeoutError < StandardError; end
  class InternalServerError < StandardError; end
  class BadGatewayError < StandardError; end
  class GatewayTimeoutError < StandardError; end
end

module Faraday
  class ConnectionFailed < StandardError; end
  class TimeoutError < StandardError; end
end

class AscVersionSlotLoadTest < Minitest::Test
  def test_slot_file_loads_without_name_errors
    load File.expand_path('../fastlane/asc_version_slot.rb', __dir__)
    assert defined?(UNSETTLED_REVIEW_SUBMISSION_STATES)
    assert defined?(RETRYABLE_REVIEW_POLL_ERRORS)
    assert_equal 7, RETRYABLE_REVIEW_POLL_ERRORS.length
  end
end
