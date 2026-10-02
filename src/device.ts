export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface HttpReply {
  status: number;
  body: unknown;
}

export type PostJson = (path: string, body: unknown) => Promise<HttpReply>;

export type LoginErrorCode = "expired_token" | "access_denied" | "already_redeemed" | "invalid_grant" | "key_limit_reached" | "rate_limited" | "timeout" | "start_failed" | "unexpected";

export class LoginError extends Error {
  constructor(
    readonly code: LoginErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LoginError";
  }
}

export interface DeviceApproval {
  apiKey: string;
  keyPrefix: string | undefined;
}

export interface PollOptions {
  post: PostJson;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  deviceCode: string;
  intervalSeconds: number;
  expiresInSeconds: number;
  onPending?: () => void;
  keysUrl?: string;
}

export const SLOW_DOWN_STEP_MS = 5000;

export function makePost(baseUrl: string, fetchImpl: typeof fetch = fetch): PostJson {
  const base = baseUrl.replace(/\/+$/, "");
  return async (path, body) => {
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
  };
}

function field(body: unknown, key: string): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
}

export async function startDeviceLogin(post: PostJson): Promise<DeviceStart> {
  let reply: HttpReply;
  try {
    reply = await post("/api/cli/device", {});
  } catch {
    throw new LoginError("start_failed", "Could not start browser login: the API is unreachable. Run `stormgtm login --key` to paste an API key instead.");
  }
  const deviceCode = field(reply.body, "device_code");
  const userCode = field(reply.body, "user_code");
  if (reply.status === 429) {
    throw new LoginError("rate_limited", "Too many sign-in attempts from this network. Wait a few minutes, or run `stormgtm login --key` to paste an API key instead.");
  }
  if (reply.status !== 200 || typeof deviceCode !== "string" || typeof userCode !== "string") {
    throw new LoginError("start_failed", `Could not start browser login (HTTP ${reply.status}). Run \`stormgtm login --key\` to paste an API key instead.`);
  }
  const verificationUri = String(field(reply.body, "verification_uri") ?? "");
  const complete = field(reply.body, "verification_uri_complete");
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: typeof complete === "string" && complete ? complete : verificationUri,
    expires_in: Number(field(reply.body, "expires_in")) || 600,
    interval: Number(field(reply.body, "interval")) || 5,
  };
}

export async function pollDeviceLogin(options: PollOptions): Promise<DeviceApproval> {
  const deadline = options.now() + options.expiresInSeconds * 1000;
  let intervalMs = Math.max(options.intervalSeconds, 1) * 1000;
  while (options.now() < deadline) {
    await options.sleep(intervalMs);
    let reply: HttpReply;
    try {
      reply = await options.post("/api/cli/device/token", { device_code: options.deviceCode });
    } catch {
      throw new LoginError("unexpected", "Login failed: network error. Check your connection and run `stormgtm login` again.");
    }
    const apiKey = field(reply.body, "api_key");
    if (reply.status === 200 && typeof apiKey === "string" && apiKey) {
      const prefix = field(reply.body, "key_prefix");
      return { apiKey, keyPrefix: typeof prefix === "string" ? prefix : undefined };
    }
    const error = field(reply.body, "error");
    if (error === "authorization_pending") {
      options.onPending?.();
      continue;
    }
    if (error === "slow_down") {
      intervalMs += SLOW_DOWN_STEP_MS;
      continue;
    }
    if (error === "expired_token") throw new LoginError("expired_token", "The login code expired. Run `stormgtm login` again.");
    if (error === "access_denied") throw new LoginError("access_denied", "Login was denied in the browser. Run `stormgtm login` to try again.");
    if (error === "already_redeemed") throw new LoginError("already_redeemed", "This login code was already used. Run `stormgtm login` again.");
    if (error === "invalid_grant") throw new LoginError("invalid_grant", "This login code is not valid. Run `stormgtm login` again.");
    if (error === "key_limit_reached") {
      throw new LoginError("key_limit_reached", `You have reached the maximum number of active API keys. Revoke one at ${options.keysUrl ?? "https://stormgtm.com/app/keys"}, then run \`stormgtm login\` again.`);
    }
    throw new LoginError("unexpected", `Login failed: ${typeof error === "string" ? error : `HTTP ${reply.status}`}`);
  }
  throw new LoginError("timeout", "Login timed out. Run `stormgtm login` again.");
}
