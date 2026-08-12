# frozen_string_literal: true

require "minitest/autorun"
require "open3"
require "rbconfig"
require_relative "../scripts/asc_url"

class AscUrlTest < Minitest::Test
  def test_accepts_relative_v1_paths
    assert_equal "https://api.appstoreconnect.apple.com/v1/apps",
      AscUrl.authenticated_uri("/v1/apps").to_s
    assert_equal "https://api.appstoreconnect.apple.com/v1?limit=1",
      AscUrl.authenticated_uri("/v1?limit=1").to_s
  end

  def test_accepts_only_the_exact_absolute_origin
    assert_equal "https://api.appstoreconnect.apple.com/v1/apps",
      AscUrl.authenticated_uri("https://api.appstoreconnect.apple.com/v1/apps").to_s
    assert_equal 443,
      AscUrl.authenticated_uri("https://api.appstoreconnect.apple.com:443/v1/apps").port
  end

  def test_rejects_untrusted_or_ambiguous_targets
    invalid = [
      nil,
      URI("https://api.appstoreconnect.apple.com/v1/apps"),
      "",
      "v1/apps",
      "/v10/apps",
      "//evil.example/v1/apps",
      "http://api.appstoreconnect.apple.com/v1/apps",
      "https://evil.example/v1/apps",
      "https://api.appstoreconnect.apple.com.evil.example/v1/apps",
      "https://API.appstoreconnect.apple.com/v1/apps",
      "https://user@api.appstoreconnect.apple.com/v1/apps",
      "https://api.appstoreconnect.apple.com:444/v1/apps",
      "https://api.appstoreconnect.apple.com/v2/apps",
      "https://api.appstoreconnect.apple.com/v1/apps#fragment",
    ]

    invalid.each do |target|
      assert_raises(AscUrl::InvalidTarget, "accepted #{target.inspect}") do
        AscUrl.authenticated_uri(target)
      end
    end
  end

  def test_cli_rejects_an_untrusted_origin_before_reading_the_key_or_requesting
    script = File.expand_path("../scripts/asc_api.rb", __dir__)
    env = {
      "ASC_KEY_ID" => "test-key",
      "ASC_ISSUER_ID" => "test-issuer",
      "ASC_KEY_FILEPATH" => File.join(__dir__, "missing-private-key.p8"),
    }
    _stdout, stderr, status = Open3.capture3(
      env, RbConfig.ruby, script, "GET", "https://evil.example/v1/apps"
    )

    refute status.success?
    assert_includes stderr, "refusing authenticated ASC request"
    refute_includes stderr, "missing-private-key"
  end
end
