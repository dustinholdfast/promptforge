import type { PackVariable } from "../lib/template";
import type { ModelOption, ProviderId } from "../lib/models";
import type { WorkspaceId } from "../lib/workspaces";

export type { PackVariable, ModelOption, ProviderId, WorkspaceId };

export type SessionUser = { id: string; email: string; name: string; role: "owner" | "member" };

export type Pack = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  workspace: WorkspaceId;
  systemPrompt: string;
  prompt: string;
  variables: PackVariable[];
  provider: ProviderId;
  model: string;
  temperature: number;
  maxTokens: number;
  version: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type RunSummary = {
  id: string;
  packId: string;
  packTitle: string;
  packVersion: number;
  model: string;
  provider: ProviderId;
  status: "running" | "ok" | "error";
  error: string | null;
  preview: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  favorite: boolean;
  createdAt: string;
};

export type PackVersion = {
  id: number;
  packId: string;
  version: number;
  systemPrompt: string;
  prompt: string;
  variables: PackVariable[];
  provider: ProviderId;
  model: string;
  note: string;
  createdBy: string;
  createdAt: string;
};

export type Workspace = { id: WorkspaceId; label: string; short: string; blurb: string };

export type Catalogue = {
  user: SessionUser;
  packs: Pack[];
  workspaces: Workspace[];
  models: ModelOption[];
  providers: Record<ProviderId, boolean>;
};
