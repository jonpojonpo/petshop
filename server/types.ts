export type Billing = 'local' | 'subscription' | 'api';
export type Harness = 'codex' | 'claude';
export type Leash = 'read-only' | 'workspace-write' | 'danger-full-access';
export interface ShopFields {
  harness: Harness;
  billing: Billing;
  body: string;
  equipment: string[];
  role: 'conductor' | 'scout' | 'advisor' | 'worker';
  refusal: 'standard' | 'unguardrailed' | 'unknown';
  model_identity: string;
  endpoint?: string;
  launch_command?: string;
  launch_args?: string[];
  api_approved?: boolean;
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
  approval_policy: 'on-request' | 'never';
  developer_instructions: string;
  petshop: ShopFields;
  [key: string]: unknown;
}
export interface Pet extends Sheet { id: string; source: string; fingerprint: string; xp: number; tokens: number; observedTps: number | null; }
export interface Body { id: string; name: string; description: string; origin: string; url: string; source: string; frames: number[]; attribution?: {creator:string;url:string;license?:string}; }
export interface Event { seq: number; ts: string; runId: string; petId?: string; type: string; data: any; }
export interface Quest {
  petId: string; advisorId?: string; objective: string; repo: string;
  check: string; allowedPaths: string[]; taskType: string;
  difficulty: 'trivial' | 'routine' | 'complex';
  requiredEquipment: string[];
  apiApproved?: boolean;
}
export interface Receipt {
  runId: string; petId: string; fingerprint: string; taskType: string;
  billing: Billing; model: string; harness: Harness;
  status: string; inputTokens: number | null; outputTokens: number | null;
  totalTokens: number | null; marginalCostUsd: number | null; providerCostUsd: number | null;
  elapsedSeconds: number; checkPassed: boolean; xp: number; commit?: string;
}
export interface Run {
  id: string; quest: Quest; status: string; createdAt: string; cwd: string;
  branch: string; baseCommit: string; events: Event[]; pets: string[];
  receipt?: Receipt[]; commit?: string; checkOutput?: string; error?: string;
  finishedAt?: string;
}
