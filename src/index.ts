import { VERSION } from "./version.js";
import { DEFAULT_API_URL, loadConfig, resolveApiKey, resolveApiUrl, type Config } from "./config.js";
import { MissingApiKeyError, StormGTMError } from "./errors.js";

export { configPath, DEFAULT_API_URL, resolveApiKey, resolveApiUrl, type Config } from "./config.js";
export { CommandError, describeError, EXIT, MissingApiKeyError, NOT_LOGGED_IN, StormGTMError, type DescribedError } from "./errors.js";

export type Verdict = "deliverable" | "risky" | "undeliverable" | "unknown";
export type Tier = "fast" | "deep";
export type OutcomeKind = "delivered" | "bounced" | "complained" | "replied" | "opened";

export interface LeadContext {
  name?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  companyDomain?: string;
  title?: string;
  source?: string;
  sourceUrl?: string;
  githubLogin?: string;
  linkedinUrl?: string;
  notes?: string;
}

export interface Policy {
  blockTlds?: string[];
  blockDomains?: string[];
  blockLocals?: string[];
  blockRoleAccounts?: boolean;
  blockFreeMail?: boolean;
  blockAnonymous?: boolean;
  blockSocialHosts?: boolean;
  blockCatchAll?: boolean;
}

export interface Reason {
  code: string;
  impact: "positive" | "negative" | "fatal" | "neutral";
  weight: number;
  detail: string;
}

export interface CheckResult {
  id: string;
  email: string;
  normalized: string | null;
  verdict: Verdict;
  score: number;
  tier: Tier;
  reasons: Reason[];
  facts: Record<string, unknown>;
  policy: { allowed: boolean; violations: Array<{ rule: string; detail: string }> };
  billable: boolean;
  credits: number;
  checkedAt: string;
}

export interface CheckRequest {
  email: string;
  context?: LeadContext;
  tier?: Tier;
  policy?: Policy;
  smtp?: boolean;
}

export interface BatchCreated {
  id: string;
  status: string;
  total: number;
  maxCredits: number;
}

export interface BatchStatus {
  id: string;
  status: "queued" | "running" | "completed";
  tier: Tier;
  total: number;
  done: number;
  createdAt: string;
  completedAt: string | null;
  offset: number;
  limit: number;
  results: Array<{ index: number; email: string; status: string; checkId: string | null; result: CheckResult | null }>;
}

export interface Me {
  id: string;
  email: string;
  credits: number;
  pricing: { fast: number; deep: number; unknown: number };
  usage30d: { total: number; credits: number; byVerdict: Record<string, number> };
}

export interface WarmupView {
  step: number;
  dailyCap: number;
  maxStep: number;
  paused: boolean;
}

export interface SendDomain {
  id: string;
  name: string;
  status: string;
  region: string | null;
  createdAt: string | null;
  warmup: WarmupView;
}

export interface DnsRecord {
  purpose: string | null;
  type: string;
  name: string;
  value: string;
  ttl: string | null;
  priority: number | null;
  status: string | null;
}

export interface SendDomainDetail extends SendDomain {
  records: DnsRecord[];
}

export interface DomainHealth {
  id: string;
  name: string;
  status: string;
  warmup: WarmupView & { ladder: number[]; pausedAt: string | null; pausedReason: string | null; sentToday: number; remainingToday: number };
  last7Days: { sent: number; bounced: number; complained: number; bounceRate: number; complaintRate: number };
  thresholds: { stepUpMaxBounceRate: number; pauseBounceRate: number; pauseComplaintRate: number };
}

export interface ResendConnection {
  connected: boolean;
  keyHint?: string;
  webhook?: "registered" | "unregistered";
  connectedAt?: string;
}

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  idempotencyKey?: string;
}

export type EmailStatus = "queued" | "sending" | "sent" | "failed";
export type DeliveryStatus = "pending" | "delivered" | "bounced" | "complained" | "failed";

export interface SentEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  status: EmailStatus;
  delivery: DeliveryStatus;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface SendResult {
  accepted: Array<SentEmail & { index: number; duplicate: boolean }>;
  rejected: Array<{ index: number; code: string; message: string }>;
}

export interface SendWindow {
  startHour: number;
  endHour: number;
  timezone: string;
}

export interface SequenceStepInput {
  delayHours: number;
  subject: string;
  text?: string;
  html?: string;
}

export interface Sequence {
  id: string;
  name: string;
  from: string;
  replyTo: string | null;
  archivedAt: string | null;
  createdAt: string;
  variables: string[];
  steps: Array<{ position: number; delayHours: number; subject: string; text: string | null; html: string | null }>;
}

export interface SequenceSummary {
  id: string;
  name: string;
  fromAddress: string;
  archivedAt: string | null;
  createdAt: string;
  steps: number;
  counts: { active: number; completed: number; stopped: number };
}

export interface Enrollment {
  id: string;
  email: string;
  status: "active" | "completed" | "stopped";
  stopReason: string | null;
  nextStep: number | null;
  nextAt: string | null;
  createdAt: string;
}

export interface EnrollResult {
  accepted: Array<Enrollment & { index: number; duplicate: boolean }>;
  rejected: Array<{ index: number; code: string; message: string }>;
  maxCredits: number;
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export const DEFAULT_BASE_URL = DEFAULT_API_URL;

export class StormGTM {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "user-agent": `stormgtm-client/${VERSION}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok && !(response.status === 422 && acceptsRejections(path, data))) {
      const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new StormGTMError(response.status, error?.code ?? "http_error", error?.message ?? `HTTP ${response.status}`, data);
    }
    return data as T;
  }

  me(): Promise<Me> {
    return this.request("GET", "/v1/me");
  }

  check(input: CheckRequest): Promise<CheckResult> {
    return this.request("POST", "/v1/check", input);
  }

  createBatch(input: { leads: Array<{ email: string; context?: LeadContext }>; tier?: Tier; policy?: Policy; smtp?: boolean; webhookUrl?: string }): Promise<BatchCreated> {
    return this.request("POST", "/v1/batches", input);
  }

  batch(id: string, options: { offset?: number; limit?: number } = {}): Promise<BatchStatus> {
    const query = new URLSearchParams({ offset: String(options.offset ?? 0), limit: String(options.limit ?? 100) });
    return this.request("GET", `/v1/batches/${encodeURIComponent(id)}?${query}`);
  }

  async waitForBatch(id: string, options: { pollMs?: number; timeoutMs?: number; limit?: number } = {}): Promise<BatchStatus> {
    const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
    for (;;) {
      const status = await this.batch(id, { limit: options.limit ?? 1000 });
      if (status.status === "completed" || Date.now() >= deadline) return status;
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 3000));
    }
  }

  reportOutcome(input: { email: string; kind: OutcomeKind; occurredAt?: string; detail?: string }): Promise<{ recorded: number; rejected: Array<{ email: string; reason: string }> }> {
    return this.request("POST", "/v1/outcomes", input);
  }

  reportOutcomes(outcomes: Array<{ email: string; kind: OutcomeKind; occurredAt?: string; detail?: string }>): Promise<{ recorded: number; rejected: Array<{ email: string; reason: string }> }> {
    return this.request("POST", "/v1/outcomes", { outcomes });
  }

  resend(): Promise<ResendConnection> {
    return this.request("GET", "/v1/send/resend");
  }

  connectResend(apiKey: string): Promise<ResendConnection & { domains: SendDomain[] }> {
    return this.request("PUT", "/v1/send/resend", { apiKey });
  }

  disconnectResend(): Promise<{ connected: false; removed: boolean }> {
    return this.request("DELETE", "/v1/send/resend");
  }

  async domains(): Promise<SendDomain[]> {
    return (await this.request<{ domains: SendDomain[] }>("GET", "/v1/send/domains")).domains;
  }

  addDomain(name: string, region?: string): Promise<SendDomainDetail> {
    return this.request("POST", "/v1/send/domains", region ? { name, region } : { name });
  }

  domain(id: string): Promise<SendDomainDetail> {
    return this.request("GET", `/v1/send/domains/${encodeURIComponent(id)}`);
  }

  verifyDomain(id: string): Promise<SendDomainDetail> {
    return this.request("POST", `/v1/send/domains/${encodeURIComponent(id)}/verify`);
  }

  domainHealth(id: string): Promise<DomainHealth> {
    return this.request("GET", `/v1/send/domains/${encodeURIComponent(id)}/health`);
  }

  resumeDomain(id: string): Promise<{ id: string; name: string; warmup: WarmupView }> {
    return this.request("POST", `/v1/send/domains/${encodeURIComponent(id)}/resume`);
  }

  send(messages: OutgoingEmail | OutgoingEmail[]): Promise<SendResult> {
    return this.request("POST", "/v1/send/emails", Array.isArray(messages) ? { messages } : messages);
  }

  async emails(limit = 50): Promise<SentEmail[]> {
    return (await this.request<{ emails: SentEmail[] }>("GET", `/v1/send/emails?limit=${limit}`)).emails;
  }

  email(id: string): Promise<SentEmail> {
    return this.request("GET", `/v1/send/emails/${encodeURIComponent(id)}`);
  }

  async suppressions(limit = 100): Promise<Array<{ address: string; reason: string; createdAt: string }>> {
    return (await this.request<{ suppressions: Array<{ address: string; reason: string; createdAt: string }> }>("GET", `/v1/send/suppressions?limit=${limit}`)).suppressions;
  }

  async sendWindow(): Promise<SendWindow | null> {
    return (await this.request<{ sendWindow: SendWindow | null }>("GET", "/v1/send/settings")).sendWindow;
  }

  createSequence(input: { name: string; from: string; replyTo?: string; steps: SequenceStepInput[] }): Promise<Sequence> {
    return this.request("POST", "/v1/send/sequences", input);
  }

  async sequences(): Promise<SequenceSummary[]> {
    return (await this.request<{ sequences: SequenceSummary[] }>("GET", "/v1/send/sequences")).sequences;
  }

  sequence(id: string): Promise<Sequence> {
    return this.request("GET", `/v1/send/sequences/${encodeURIComponent(id)}`);
  }

  archiveSequence(id: string): Promise<{ id: string; archived: true; stopped: number }> {
    return this.request("POST", `/v1/send/sequences/${encodeURIComponent(id)}/archive`);
  }

  enroll(sequenceId: string, leads: Array<{ email: string; variables?: Record<string, string> }>): Promise<EnrollResult> {
    return this.request("POST", `/v1/send/sequences/${encodeURIComponent(sequenceId)}/enrollments`, { leads });
  }

  async enrollments(sequenceId: string, limit = 100): Promise<Enrollment[]> {
    return (await this.request<{ enrollments: Enrollment[] }>("GET", `/v1/send/sequences/${encodeURIComponent(sequenceId)}/enrollments?limit=${limit}`)).enrollments;
  }

  stopEnrollment(sequenceId: string, enrollmentId: string): Promise<{ id: string; status: "stopped"; stopReason: string }> {
    return this.request("POST", `/v1/send/sequences/${encodeURIComponent(sequenceId)}/enrollments/${encodeURIComponent(enrollmentId)}/stop`);
  }

  async setSendWindow(window: SendWindow | null): Promise<SendWindow | null> {
    return (await this.request<{ sendWindow: SendWindow | null }>("PUT", "/v1/send/settings", { sendWindow: window })).sendWindow;
  }
}

function acceptsRejections(path: string, data: unknown): boolean {
  const rejectable = path === "/v1/send/emails" || /^\/v1\/send\/sequences\/[^/]+\/enrollments$/.test(path);
  return rejectable && Array.isArray((data as { rejected?: unknown } | null)?.rejected);
}

export function clientFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch, config: Config = loadConfig()): StormGTM {
  const apiKey = resolveApiKey(env, config);
  if (!apiKey) throw new MissingApiKeyError();
  return new StormGTM({ apiKey, baseUrl: resolveApiUrl(env, config), fetch: fetchImpl });
}

export function summarize(result: Pick<CheckResult, "email" | "verdict" | "score" | "reasons" | "policy">): string {
  const top = result.reasons.filter((r) => r.impact === "fatal").concat(result.reasons.filter((r) => r.impact !== "fatal" && r.weight !== 0)).slice(0, 4);
  const lines = [`${result.email}: ${result.verdict} (${result.score}/100)${result.policy.allowed ? "" : " — blocked by policy"}`];
  for (const reason of top) lines.push(`  ${reason.impact === "fatal" ? "fatal" : `${reason.weight > 0 ? "+" : ""}${reason.weight}`} ${reason.code}: ${reason.detail}`);
  return lines.join("\n");
}
