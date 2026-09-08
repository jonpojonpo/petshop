/** "free-api" is remote and unmetered; "api" is remote and metered. Both are
 * distinct from "local" and "subscription" so routing can never confuse them. */
export type Billing = "local" | "subscription" | "api" | "free-api";
export type Harness = "codex" | "claude";
export type Leash = "read-only" | "workspace-write" | "danger-full-access";
export interface Capabilities {
  chat: boolean;
  tools: boolean;
  structuredOutputs: boolean;
  reasoning: boolean;
}
export interface Pricing {
  prompt: string;
  completion: string;
}
export interface RosterEntry {
  id: string;
  name: string;
  contextLength: number;
  maxCompletionTokens?: number | null;
  capabilities: Capabilities;
  pricing: Pricing;
}
export interface Roster {
  version: number;
  capturedAt: string;
  source: string;
  note?: string;
  models: RosterEntry[];
}
/** A visitor is an unadopted candidate: it has no sheet on disk until you keep it. */
export interface Visitor {
  modelId: string;
  name: string;
  contextLength: number;
  capabilities: Capabilities;
  pricing: Pricing;
  body: string;
  provider: "openrouter";
  billing: Billing;
  remote: boolean;
  notice: string;
}
export interface ShopFields {
  harness: Harness;
  billing: Billing;
  body: string;
  equipment: string[];
  role: "conductor" | "scout" | "advisor" | "worker";
  refusal: "standard" | "unguardrailed" | "unknown";
  model_identity: string;
  endpoint?: string;
  launch_command?: string;
  launch_args?: string[];
  api_approved?: boolean;
  /** Remote catalogue this pet is served from. Absent means local or first-party. */
  provider?: "openrouter";
  /** Recorded so the shop can show what a free pet was, and price a paid swap. */
  context_length?: number;
  capabilities?: Capabilities;
  pricing?: Pricing;
  [key: string]: unknown;
}
export interface Sheet {
  name: string;
  description: string;
  model: string;
  model_provider?: string;
  model_reasoning_effort: string;
  model_context_window?: number;
  sandbox_mode: Leash;
  approval_policy: "on-request" | "never";
  developer_instructions: string;
  petshop: ShopFields;
  [key: string]: unknown;
}
export interface Pet extends Sheet {
  id: string;
  source: string;
  fingerprint: string;
  xp: number;
  tokens: number;
  observedTps: number | null;
}
export interface Body {
  id: string;
  name: string;
  description: string;
  origin: string;
  url: string;
  source: string;
  frames: number[];
  attribution?: { creator: string; url: string; license?: string };
}
export interface Event {
  seq: number;
  ts: string;
  runId: string;
  petId?: string;
  type: string;
  data: any;
}
export interface Quest {
  petId: string;
  advisorId?: string;
  objective: string;
  repo: string;
  check: string;
  allowedPaths: string[];
  taskType: string;
  difficulty: "trivial" | "routine" | "complex";
  requiredEquipment: string[];
  apiApproved?: boolean;
  /** Sending code to a remote provider and letting it write are separate consents. */
  remoteWriteApproved?: boolean;
}
export interface Receipt {
  runId: string;
  petId: string;
  fingerprint: string;
  taskType: string;
  billing: Billing;
  model: string;
  harness: Harness;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  marginalCostUsd: number | null;
  providerCostUsd: number | null;
  elapsedSeconds: number;
  checkPassed: boolean;
  xp: number;
  commit?: string;
  /** OpenRouter rotates the backend behind a stable model name. The requested id,
   * the id actually served, and the serving provider are all recorded so XP is
   * never credited to a model that did not do the work. */
  requestedModel?: string;
  servedModel?: string | null;
  servedProvider?: string | null;
}
export interface Run {
  id: string;
  quest: Quest;
  status: string;
  createdAt: string;
  cwd: string;
  branch: string;
  baseCommit: string;
  events: Event[];
  pets: string[];
  receipt?: Receipt[];
  commit?: string;
  checkOutput?: string;
  error?: string;
  finishedAt?: string;
}
