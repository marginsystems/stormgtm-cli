import { VERSION } from "./version.js";
import { DEFAULT_API_URL, loadConfig, resolveApiKey, resolveApiUrl, type Config } from "./config.js";
import { MissingApiKeyError, StormGTMError } from "./errors.js";
import { SseDecoder } from "./sse.js";

export { configPath, DEFAULT_API_URL, resolveApiKey, resolveApiUrl, type Config } from "./config.js";
export { SseDecoder } from "./sse.js";
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
  mailboxId?: string;
  from?: string;
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
  mailboxId: string | null;
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

export type InboxFolder = "inbox" | "sent" | "archived" | "spam";
export type InboxDirection = "inbound" | "outbound";

export interface InboxThread {
  id: string;
  subject: string;
  counterpart: string;
  counterpartName?: string | null;
  participants: string[];
  mailbox: string | null;
  messageCount: number;
  unreadCount: number;
  unread: boolean;
  snippet: string;
  lastMessageAt: string;
  archived: boolean;
  spam: boolean;
  hasAttachment: boolean;
}

export interface InboxAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  blocked: string | null;
  downloadUrl: string | null;
}

export interface InboxMessageAuth {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  verifiedSender: boolean | null;
}

export interface InboxMessage {
  id: string;
  direction: InboxDirection;
  from: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  replyTo: string | null;
  subject: string;
  text: string | null;
  replyText: string | null;
  hasHtml: boolean;
  at: string;
  read: boolean;
  auth: InboxMessageAuth;
  attachments: InboxAttachment[];
}

export interface InboxThreadDetail extends InboxThread {
  messages: InboxMessage[];
}

export interface ThreadsQuery {
  folder?: InboxFolder;
  unread?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface ThreadsPage {
  threads: InboxThread[];
  nextCursor: string | null;
}

export interface FolderCount {
  total: number;
  unread: number;
}

export type InboxCounts = Record<InboxFolder, FolderCount>;

export interface ReplyInput {
  text: string;
  html?: string;
  from?: string;
  idempotencyKey?: string;
}

export interface ReplyResult {
  id: string;
  threadId: string;
  status: EmailStatus;
  duplicate: boolean;
  from: string;
  to: string;
  subject: string;
}

export interface RadarChat {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface RadarMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface RadarLead {
  id: string;
  chatId: string | null;
  email: string;
  name: string | null;
  title: string | null;
  company: string | null;
  companyHost: string | null;
  sourceUrl: string;
  note: string | null;
  origin: RadarLeadOrigin;
  verdict: Verdict | null;
  checkId: string | null;
  createdAt: string;
}

export type RadarLeadOrigin = "web" | "leadsforge" | "manual";

export interface AddLeadInput {
  email: string;
  name?: string;
  title?: string;
  company?: string;
  note?: string;
}

export interface AddLeadsResult {
  leads: RadarLead[];
  duplicates: string[];
  rejected: Array<{ index: number; code: string; message: string }>;
}

export interface LeadsforgeStatus {
  connected: boolean;
  keyHint?: string;
  connectedAt?: string;
  updatedAt?: string;
  credits?: number;
}

export type RadarEvent =
  | { type: "user_message"; message: RadarMessage }
  | { type: "chat_renamed"; name: string }
  | { type: "status"; stage: string; label?: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; phase: "start" | "result"; name: string; summary: string; callId: string; isError?: boolean }
  | { type: "delta"; text: string }
  | { type: "leads"; leads: RadarLead[] }
  | { type: "assistant_message"; message: RadarMessage }
  | { type: "done" }
  | { type: "error"; message: string; kind: string }
  | { type: "ping" };

export interface FindLeadsInput {
  content: string;
  chatId?: string;
  onEvent?: (event: RadarEvent) => void;
  signal?: AbortSignal;
}

export interface FindLeadsResult {
  chatId: string;
  answer: string;
  leads: RadarLead[];
}

export const FIND_LEADS_TIMEOUT_MS = 5 * 60_000;

export type MailboxStatus = "active" | "error" | "paused";
export type MailboxProvider = "google" | "microsoft" | "mailforge" | "infraforge" | "other";

export interface MailboxServer {
  host: string;
  port: number;
  security: "ssl" | "starttls";
  username: string;
}

export interface MailboxCaps {
  warmupStep: number;
  maxStep: number;
  week?: number;
  nextDailyCap?: number | null;
  nextStepAt?: string | null;
  dailyCap: number;
  dailyCapOverride: number | null;
  gapMinutes: number;
  sentToday: number;
}

export type MailboxPhase = "warming_up" | "ramping" | "full" | "paused" | "needs_attention";

export interface MailboxWarmup {
  enabled: boolean;
  dailyTarget: number;
  day?: number;
  coldSendsStartAt?: string | null;
}

export interface Mailbox {
  phase?: MailboxPhase;
  warmup?: MailboxWarmup;
  id: string;
  address: string;
  displayName: string | null;
  domain: string;
  kind: "smtp";
  status: MailboxStatus;
  smtp: MailboxServer;
  imap: MailboxServer;
  lastTestAt: string | null;
  lastError: string | null;
  pausedAt: string | null;
  pausedReason: string | null;
  signature: string | null;
  caps: MailboxCaps;
  createdAt: string;
  updatedAt: string;
}

export interface MailboxServerInput {
  host?: string;
  port?: number;
  security?: "ssl" | "starttls";
  username?: string;
  password?: string;
}

export interface ConnectMailboxInput {
  address: string;
  displayName?: string;
  provider?: MailboxProvider;
  smtp: MailboxServerInput & { password: string };
  imap?: MailboxServerInput;
}

export type MailboxImportRow = { index: number; address: string; ok: true; mailbox: Mailbox } | { index: number; address: string; ok: false; code: string; message: string };

export interface MailboxImportResult {
  connected: number;
  failed: number;
  results: MailboxImportRow[];
}

export interface MailboxDomain {
  domain: string;
  mailboxes: number;
  unsubscribeHost: string | null;
  verified: boolean;
  verifiedAt: string | null;
  record: { type: string; name: string; value: string } | null;
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

  private open(method: string, path: string, body: unknown, signal: AbortSignal, accept?: string): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(accept ? { accept } : {}),
        "user-agent": `stormgtm-client/${VERSION}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.open(method, path, body, AbortSignal.timeout(this.options.timeoutMs ?? 60_000));
    const data = await readBody(response);
    if (!response.ok && !(response.status === 422 && acceptsRejections(path, data))) throw apiFailure(response.status, data);
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

  async listMailboxes(): Promise<Mailbox[]> {
    return (await this.request<{ mailboxes: Mailbox[] }>("GET", "/v1/mailboxes")).mailboxes;
  }

  mailbox(id: string): Promise<Mailbox> {
    return this.request("GET", `/v1/mailboxes/${encodeURIComponent(id)}`);
  }

  connectMailbox(input: ConnectMailboxInput): Promise<Mailbox> {
    return this.request("POST", "/v1/mailboxes", input);
  }

  importMailboxes(csv: string, provider?: MailboxProvider): Promise<MailboxImportResult> {
    return this.request("POST", "/v1/mailboxes/import", provider ? { csv, provider } : { csv });
  }

  testMailbox(id: string): Promise<Mailbox> {
    return this.request("POST", `/v1/mailboxes/${encodeURIComponent(id)}/test`);
  }

  async mailboxDomains(): Promise<MailboxDomain[]> {
    return (await this.request<{ domains: MailboxDomain[] }>("GET", "/v1/mailboxes/domains")).domains;
  }

  setUnsubscribeHost(domain: string, host: string | null): Promise<MailboxDomain> {
    return this.request("PUT", `/v1/mailboxes/domains/${encodeURIComponent(domain)}/unsubscribe-host`, { host });
  }

  verifyUnsubscribeHost(domain: string): Promise<MailboxDomain> {
    return this.request("POST", `/v1/mailboxes/domains/${encodeURIComponent(domain)}/unsubscribe-host/verify`);
  }

  async sendWindow(): Promise<SendWindow | null> {
    return (await this.request<{ sendWindow: SendWindow | null }>("GET", "/v1/send/settings")).sendWindow;
  }

  createSequence(input: { name: string; mailboxId?: string; from?: string; replyTo?: string; steps: SequenceStepInput[] }): Promise<Sequence> {
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

  threads(query: ThreadsQuery = {}): Promise<ThreadsPage> {
    const params = new URLSearchParams();
    if (query.folder) params.set("folder", query.folder);
    if (query.unread !== undefined) params.set("unread", String(query.unread));
    if (query.q) params.set("q", query.q);
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    const search = params.toString();
    return this.request("GET", `/v1/inbox/threads${search ? `?${search}` : ""}`);
  }

  thread(id: string): Promise<InboxThreadDetail> {
    return this.request("GET", `/v1/inbox/threads/${encodeURIComponent(id)}`);
  }

  reply(threadId: string, input: ReplyInput): Promise<ReplyResult> {
    return this.request("POST", `/v1/inbox/threads/${encodeURIComponent(threadId)}/reply`, input);
  }

  markRead(ids: string[], read = true): Promise<{ updated: number }> {
    return this.request("POST", "/v1/inbox/threads/read", { ids, read });
  }

  archiveThreads(ids: string[], archived = true): Promise<{ updated: number }> {
    return this.request("POST", "/v1/inbox/threads/archive", { ids, archived });
  }

  spamThreads(ids: string[], spam = true): Promise<{ updated: number }> {
    return this.request("POST", "/v1/inbox/threads/spam", { ids, spam });
  }

  async inboxCounts(): Promise<InboxCounts> {
    return (await this.request<{ counts: InboxCounts }>("GET", "/v1/inbox/counts")).counts;
  }

  async radarChats(): Promise<RadarChat[]> {
    return (await this.request<{ chats: RadarChat[] }>("GET", "/v1/radar/chats")).chats;
  }

  async createRadarChat(name?: string): Promise<RadarChat> {
    return (await this.request<{ chat: RadarChat }>("POST", "/v1/radar/chats", name ? { name } : {})).chat;
  }

  radarMessages(chatId: string): Promise<{ chat: RadarChat; messages: RadarMessage[] }> {
    return this.request("GET", `/v1/radar/chats/${encodeURIComponent(chatId)}/messages`);
  }

  async radarLeads(query: { chatId?: string } = {}): Promise<RadarLead[]> {
    const search = query.chatId ? `?${new URLSearchParams({ chatId: query.chatId })}` : "";
    return (await this.request<{ leads: RadarLead[] }>("GET", `/v1/radar/leads${search}`)).leads;
  }

  radarLeadsAfter(query: { after: string; chatId?: string; limit?: number }): Promise<{ leads: RadarLead[]; nextAfter: string }> {
    const search = new URLSearchParams({ after: query.after });
    if (query.chatId) search.set("chatId", query.chatId);
    if (query.limit !== undefined) search.set("limit", String(query.limit));
    return this.request("GET", `/v1/radar/leads?${search}`);
  }

  addRadarLeads(leads: AddLeadInput[]): Promise<AddLeadsResult> {
    return this.request("POST", "/v1/radar/leads", { leads });
  }

  async leadsforge(): Promise<LeadsforgeStatus> {
    return (await this.request<{ leadsforge: LeadsforgeStatus }>("GET", "/v1/radar/leadsforge")).leadsforge;
  }

  async connectLeadsforge(apiKey: string): Promise<LeadsforgeStatus> {
    return (await this.request<{ leadsforge: LeadsforgeStatus }>("PUT", "/v1/radar/leadsforge", { apiKey })).leadsforge;
  }

  async disconnectLeadsforge(): Promise<void> {
    await this.request("DELETE", "/v1/radar/leadsforge");
  }

  qualifyRadarLeads(ids: string[], tier?: Tier): Promise<{ leads: RadarLead[]; remaining: number }> {
    return this.request("POST", "/v1/radar/leads/qualify", tier ? { ids, tier } : { ids });
  }

  deleteRadarLead(id: string): Promise<{ ok: true }> {
    return this.request("DELETE", `/v1/radar/leads/${encodeURIComponent(id)}`);
  }

  cancelRadarChat(chatId: string): Promise<{ ok: true }> {
    return this.request("POST", `/v1/radar/chats/${encodeURIComponent(chatId)}/cancel`);
  }

  async findLeads(input: FindLeadsInput): Promise<FindLeadsResult> {
    const chatId = input.chatId ?? (await this.createRadarChat()).id;
    const timeout = AbortSignal.timeout(FIND_LEADS_TIMEOUT_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const response = await this.open("POST", `/v1/radar/chats/${encodeURIComponent(chatId)}/message`, { content: input.content }, signal, "text/event-stream");
    if (!response.ok) throw apiFailure(response.status, await readBody(response));
    if (!response.body) throw new StormGTMError(response.status, "stream_missing", "The lead search returned no stream");
    const leads = new Map<string, RadarLead>();
    let answer: string | undefined;
    let done = false;
    const handle = (data: string) => {
      let event: RadarEvent;
      try {
        event = JSON.parse(data) as RadarEvent;
      } catch {
        return;
      }
      if (!event || typeof event !== "object" || typeof event.type !== "string") return;
      input.onEvent?.(event);
      if (event.type === "leads") for (const lead of event.leads) leads.set(lead.id, lead);
      else if (event.type === "assistant_message") answer = event.message.content;
      else if (event.type === "done") done = true;
      else if (event.type === "error") throw new StormGTMError(response.status, event.kind || "radar_error", event.message || "The lead search failed", event);
    };
    const decoder = new SseDecoder();
    const text = new TextDecoder();
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        for (const data of decoder.push(text.decode(value, { stream: true }))) handle(data);
      }
      for (const data of decoder.push(text.decode())) handle(data);
      for (const data of decoder.flush()) handle(data);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
    if (answer === undefined && !done) throw new StormGTMError(response.status, "stream_incomplete", "The lead search ended before it finished; check radarLeads for anything it saved");
    return { chatId, answer: answer ?? "", leads: [...leads.values()] };
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function apiFailure(status: number, data: unknown): StormGTMError {
  const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
  return new StormGTMError(status, error?.code ?? "http_error", error?.message ?? `HTTP ${status}`, data);
}

function acceptsRejections(path: string, data: unknown): boolean {
  const rejectable = path === "/v1/send/emails" || path === "/v1/radar/leads" || /^\/v1\/send\/sequences\/[^/]+\/enrollments$/.test(path);
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
