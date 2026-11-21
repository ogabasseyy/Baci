# frozen_string_literal: true

require "bundler/setup"
require "stringio"
require "tmpdir"
require_relative "patch-ios-activesupport"

if ARGV == ["--verify-installed"]
  gem_spec = Gem.loaded_specs.fetch("activesupport")
  abort "Unexpected ActiveSupport version #{gem_spec.version}" unless gem_spec.version.to_s == IosActiveSupportBackport::VERSION

  installed_path = File.join(gem_spec.full_gem_path, "lib/active_support/inflector/methods.rb")
  installed_source = File.binread(installed_path)
  installed_digest = Digest::SHA256.hexdigest(installed_source)
  abort "Installed ActiveSupport patch digest mismatch at #{installed_path}" unless installed_digest == IosActiveSupportBackport::PATCHED_DIGEST
  abort "Installed ActiveSupport still defines const_regexp" if installed_source.include?("const_regexp")
  abort "Installed ActiveSupport lacks literal LoadError matching" unless installed_source.include?(IosActiveSupportBackport::PATCHED_MATCH.lines.last.strip)

  require "active_support/inflector"
  abort "Installed ActiveSupport ordinary constant lookup failed" unless ActiveSupport::Inflector.safe_constantize("String") == String
  abort "Installed ActiveSupport unknown constant lookup changed" unless ActiveSupport::Inflector.safe_constantize("DefinitelyMissingConstant").nil?

  puts "Installed ActiveSupport backport verified"
  exit
end

def assert_equal(expected, actual, message)
  raise "#{message}: expected #{expected.inspect}, got #{actual.inspect}" unless expected == actual
end

def assert_includes(string, substring, message)
  raise "#{message}: missing #{substring.inspect}" unless string.include?(substring)
end

def refute_includes(string, substring, message)
  raise "#{message}: unexpectedly found #{substring.inspect}" if string.include?(substring)
end

def assert_raises(exception_class, message)
  yield
  raise "#{message}: expected #{exception_class}"
rescue exception_class
  true
end

def with_fixture
  source_path = File.join(
    Gem.loaded_specs.fetch("activesupport").full_gem_path,
    "lib/active_support/inflector/methods.rb"
  )
  Dir.mktmpdir("ios-activesupport-backport-test-") do |temp_dir|
    fixture_path = File.join(temp_dir, "methods.rb")
    source = File.binread(source_path)
    digest = Digest::SHA256.hexdigest(source)
    initial_result = if digest == IosActiveSupportBackport::ORIGINAL_DIGEST
      :patched
    elsif digest == IosActiveSupportBackport::PATCHED_DIGEST
      :already_patched
    else
      raise "Unexpected ActiveSupport fixture digest #{digest}"
    end
    File.binwrite(fixture_path, source)
    yield fixture_path, initial_result
  end
end

def run_test(name)
  yield
  puts "PASS #{name}"
rescue SystemExit => error
  warn "FAIL #{name}: exited with status #{error.status}: #{error.message}"
  exit error.status
rescue StandardError => error
  warn "FAIL #{name}: #{error.message}"
  exit 1
end

run_test("patches pristine or preserves cached patched source and normal lookups") do
  with_fixture do |fixture_path, initial_result|
    assert_equal(initial_result, IosActiveSupportBackport.apply!(path: fixture_path, version: "7.2.3.1"), "first patch")

    patched_source = File.binread(fixture_path)
    assert_equal(IosActiveSupportBackport::PATCHED_DIGEST, Digest::SHA256.hexdigest(patched_source), "patched digest")
    assert_includes(patched_source, 'message.include?("Unable to autoload constant #{constant_name}")', "literal lookup")
    refute_includes(patched_source, "const_regexp", "removed helper")
    refute_includes(patched_source, IosActiveSupportBackport::ORIGINAL_MATCH, "removed dynamic matcher")

    assert_equal(:already_patched, IosActiveSupportBackport.apply!(path: fixture_path, version: "7.2.3.1"), "repeat patch")
    assert_equal(patched_source, File.binread(fixture_path), "idempotent bytes")

    load fixture_path
    assert_equal(String, ActiveSupport::Inflector.safe_constantize("String"), "ordinary constant lookup")
    assert_equal(nil, ActiveSupport::Inflector.safe_constantize("DefinitelyMissingConstant"), "unknown constant lookup")

    original_constantize = ActiveSupport::Inflector.method(:constantize)
    begin
      ActiveSupport::Inflector.define_singleton_method(:constantize) do |_name|
        raise LoadError, "Unable to autoload constant String"
      end
      assert_equal(nil, ActiveSupport::Inflector.safe_constantize("String"), "matching autoload error")

      ActiveSupport::Inflector.define_singleton_method(:constantize) do |_name|
        raise LoadError, "Unable to autoload constant UnrelatedName"
      end
      assert_raises(LoadError, "nonmatching autoload error") do
        ActiveSupport::Inflector.safe_constantize("String")
      end
    ensure
      ActiveSupport::Inflector.define_singleton_method(:constantize, original_constantize)
    end
  end
end

run_test("rejects unexpected source without modifying it") do
  with_fixture do |fixture_path, _initial_result|
    File.open(fixture_path, "ab") { |file| file.write("\n# unexpected source change\n") }
    original = File.binread(fixture_path)
    captured_stderr = StringIO.new
    previous_stderr = $stderr
    $stderr = captured_stderr

    begin
      begin
        IosActiveSupportBackport.apply!(path: fixture_path, version: "7.2.3.1")
        raise "unexpected source was accepted"
      rescue SystemExit => error
        assert_equal(1, error.status, "unexpected source exit status")
      end
    ensure
      $stderr = previous_stderr
    end

    assert_includes(captured_stderr.string, "Unexpected ActiveSupport source digest", "unexpected source diagnostic")
    assert_equal(original, File.binread(fixture_path), "unexpected source remains unchanged")
  end
end
