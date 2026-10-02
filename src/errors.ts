import { DEFAULT_API_URL } from "./config.js";

export const EXIT = {
  ok: 0,
  failed: 1,
  rejected: 2,
  usage: 3,
  credits: 4,
  auth: 6,
  rateLimited: 7,
} as const;

export class StormGTMError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "StormGTMError";
  }
}

export const NOT_LOGGED_IN = "Not logged in. Run `stormgtm login`, or set STORMGTM_API_KEY.";

export class MissingApiKeyError extends Error {
  readonly code = "missing_api_key";

  constructor(message = NOT_LOGGED_IN) {
    super(message);
    this.name = "MissingApiKeyError";
  }
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.failed,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export function usageError(usage: string): CommandError {
  return new CommandError(`Usage: ${usage}`, EXIT.usage);
}

export interface DescribedError {
  message: string;
  exitCode: number;
}

function retryAfterSeconds(details: unknown): number | undefined {
  const error = details && typeof details === "object" ? (details as { error?: { retry_after_seconds?: unknown } }).error : undefined;
  const seconds = Number(error?.retry_after_seconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

function networkCode(error: Error): string | undefined {
  const cause = (error as { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

function webUrl(apiUrl: string, path: string): string {
  return `${apiUrl.replace(/\/+$/, "")}${path}`;
}

export function describeError(error: unknown, apiUrl: string = DEFAULT_API_URL): DescribedError {
  if (error instanceof CommandError) return { message: error.message, exitCode: error.exitCode };
  if (error instanceof MissingApiKeyError) return { message: error.message, exitCode: EXIT.auth };
  if (error instanceof StormGTMError) {
    if (error.status === 401) {
      return { message: "Your API key is invalid or was revoked. Run `stormgtm login` to sign in again.", exitCode: EXIT.auth };
    }
    if (error.code === "insufficient_credits") {
      return { message: `Not enough credits. Top up at ${webUrl(apiUrl, "/app/billing")}`, exitCode: EXIT.credits };
    }
    if (error.status === 429) {
      const wait = retryAfterSeconds(error.details);
      return { message: `Rate limited. ${wait ? `Retry in ${wait}s.` : "Wait a moment and try again."}`, exitCode: EXIT.rateLimited };
    }
    return { message: `${error.message} (${error.code})`, exitCode: EXIT.failed };
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return { message: `The request to ${apiUrl} timed out. Try again.`, exitCode: EXIT.failed };
    if (error.name === "TypeError" && (error.message === "fetch failed" || networkCode(error))) {
      const hint = apiUrl === DEFAULT_API_URL ? "Check your connection." : "Check your connection and STORMGTM_API_URL.";
      return { message: `Could not reach ${apiUrl}. ${hint}`, exitCode: EXIT.failed };
    }
    return { message: error.message, exitCode: EXIT.failed };
  }
  return { message: String(error), exitCode: EXIT.failed };
}
