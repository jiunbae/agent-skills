#!/usr/bin/env ruby
# upload_shot.rb <APP_SCREENSHOT_SET_ID> <file.png>
# Uploads ONE screenshot to a set via the 3-step reserve -> PUT -> commit flow. Prints the new id.
# Same env as asc_api.rb (ASC_KEY_ID, ASC_ISSUER_ID, optional ASC_KEY_FILEPATH).
require "openssl"; require "json"; require "base64"; require "net/http"; require "uri"; require "time"; require "digest"

KEY_ID = ENV["ASC_KEY_ID"] or abort("set ASC_KEY_ID")
ISSUER = ENV["ASC_ISSUER_ID"] or abort("set ASC_ISSUER_ID")
KEYP   = ENV["ASC_KEY_FILEPATH"] || File.expand_path("~/.appstoreconnect/private_keys/AuthKey_#{KEY_ID}.p8")

def b64(s); Base64.urlsafe_encode64(s).delete("="); end
def jwt
  hdr = b64({alg: "ES256", kid: KEY_ID, typ: "JWT"}.to_json)
  now = Time.now.to_i
  pay = b64({iss: ISSUER, iat: now, exp: now + 1080, aud: "appstoreconnect-v1"}.to_json)
  data = "#{hdr}.#{pay}"
  key = OpenSSL::PKey::EC.new(File.read(KEYP))
  der = key.sign(OpenSSL::Digest::SHA256.new, data)
  a = OpenSSL::ASN1.decode(der)
  r = a.value[0].value.to_s(2).rjust(32, "\x00")
  s = a.value[1].value.to_s(2).rjust(32, "\x00")
  "#{data}.#{b64(r + s)}"
end
def req(method, path, body = nil, raw_headers = nil)
  url = path.start_with?("http") ? path : "https://api.appstoreconnect.apple.com#{path}"
  uri = URI(url); http = Net::HTTP.new(uri.host, uri.port); http.use_ssl = true
  klass = {"GET"=>Net::HTTP::Get,"POST"=>Net::HTTP::Post,"PATCH"=>Net::HTTP::Patch,"PUT"=>Net::HTTP::Put}[method]
  r = klass.new(uri.request_uri)
  if raw_headers
    raw_headers.each { |h| r[h["name"]] = h["value"] }
  else
    r["Authorization"] = "Bearer #{jwt}"; r["Content-Type"] = "application/json"
  end
  r.body = body if body
  res = http.request(r)
  [res.code.to_i, res.body]
end

set_id, path = ARGV[0], ARGV[1]
bytes = File.binread(path)
fname = File.basename(path)

# 1) reserve
resv = {data: {type: "appScreenshots",
  attributes: {fileName: fname, fileSize: bytes.bytesize},
  relationships: {appScreenshotSet: {data: {type: "appScreenshotSets", id: set_id}}}}}.to_json
code, b = req("POST", "/v1/appScreenshots", resv)
abort "reserve failed HTTP #{code}: #{b}" unless code == 201
d = JSON.parse(b)["data"]; sid = d["id"]

# 2) upload bytes per operation (usually one)
d["attributes"]["uploadOperations"].each do |op|
  c, bb = req("PUT", op["url"], bytes.byteslice(op["offset"], op["length"]), op["requestHeaders"])
  abort "upload op failed HTTP #{c}: #{bb}" unless c.between?(200, 299)
end

# 3) commit with md5 checksum
patch = {data: {type: "appScreenshots", id: sid,
  attributes: {uploaded: true, sourceFileChecksum: Digest::MD5.hexdigest(bytes)}}}.to_json
code, b = req("PATCH", "/v1/appScreenshots/#{sid}", patch)
abort "commit failed HTTP #{code}: #{b}" unless code == 200
puts sid
