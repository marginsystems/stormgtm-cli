import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandError, describeError, EXIT, MissingApiKeyError, StormGTMError, usageError } from "./errors.js";

test("a missing key and a rejected key both exit 6 with a login hint", () => {
  assert.deepEqual(describeError(new MissingApiKeyError()), { message: "Not logged in. Run `stormgtm login`, or set STORMGTM_API_KEY.", exitCode: EXIT.auth });
  const rejected = describeError(new StormGTMError(401, "invalid_api_key", "API key is invalid or revoked"));
  assert.equal(rejected.exitCode, EXIT.auth);
  assert.match(rejected.message, /stormgtm login/);
});

test("credits, rate limits and other API errors map to their own exit codes", () => {
  const credits = describeError(new StormGTMError(402, "insufficient_credits", "Not enough credits"), "https://api.test");
  assert.deepEqual(credits, { message: "Not enough credits. Top up at https://api.test/app/billing", exitCode: EXIT.credits });
  const limited = describeError(new StormGTMError(429, "rate_limited", "Too many requests", { error: { retry_after_seconds: 12.2 } }));
  assert.deepEqual(limited, { message: "Rate limited. Retry in 13s.", exitCode: EXIT.rateLimited });
  assert.deepEqual(describeError(new StormGTMError(404, "not_found", "Batch not found")), { message: "Batch not found (not_found)", exitCode: EXIT.failed });
});

test("network failures and timeouts name the API instead of printing fetch internals", () => {
  const offline = new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
  assert.deepEqual(describeError(offline), { message: "Could not reach https://stormgtm.com. Check your connection.", exitCode: EXIT.failed });
  assert.match(describeError(offline, "http://localhost:8787").message, /STORMGTM_API_URL/);
  const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  assert.match(describeError(timeout).message, /timed out/);
});

test("command and usage errors keep their own message and code", () => {
  assert.deepEqual(describeError(new CommandError("nope", EXIT.rejected)), { message: "nope", exitCode: EXIT.rejected });
  assert.deepEqual(describeError(usageError("stormgtm check <email>")), { message: "Usage: stormgtm check <email>", exitCode: EXIT.usage });
});
