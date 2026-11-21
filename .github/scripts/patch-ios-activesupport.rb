# frozen_string_literal: true

require "bundler/setup"
require "digest"
require "tempfile"

# CocoaPods Core requires ActiveSupport < 8. Port the literal LoadError match
# from Rails 210ac22d446c8e2625b091e79256806b836eee20 (GHSA-8474-xrp6-wh69)
# until CocoaPods can use a patched published gem.
gem_spec = Gem.loaded_specs.fetch("activesupport")
abort "Recheck the ActiveSupport backport for #{gem_spec.version}" unless gem_spec.version.to_s == "7.2.3.1"

path = File.join(gem_spec.full_gem_path, "lib/active_support/inflector/methods.rb")
source = File.binread(path)
digest = Digest::SHA256.hexdigest(source)
original_digest = "3b8028113ff51eac58aec28315a0acf95772decfd3f06f220b9431dcad911831"
patched_digest = "39d96d0fed3817d4e8da5eb7d982892679953fe2c957bb33686cfff937b98d96"
exit if digest == patched_digest
abort "Unexpected ActiveSupport source digest in #{path}" unless digest == original_digest

original = '      raise unless /Unable to autoload constant #{const_regexp(camel_cased_word)}/.match?(message)'
replacement = [
  '      constant_name = camel_cased_word.split("::").find { |part| !part.empty? } || camel_cased_word',
  '      raise unless message.include?("Unable to autoload constant #{constant_name}")'
].join("\n")
patched = source.sub(original, replacement)
abort "ActiveSupport backport output did not match the expected digest" unless Digest::SHA256.hexdigest(patched) == patched_digest

Tempfile.create(["activesupport-", ".rb"], File.dirname(path), binmode: true) do |file|
  file.write(patched)
  file.chmod(File.stat(path).mode & 0o777)
  file.close
  File.rename(file.path, path)
end
