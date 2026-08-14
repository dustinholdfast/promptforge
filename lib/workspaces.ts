/**
 * PromptForge is shared across the businesses. A pack belongs to exactly one
 * workspace so the library stays scannable as it grows.
 */

export type WorkspaceId = "jinni" | "holdfast" | "fieldcred" | "shared";

export const WORKSPACES: Array<{ id: WorkspaceId; label: string; short: string; blurb: string }> = [
  {
    id: "jinni",
    label: "Jinni Vacations",
    short: "JV",
    blurb: "Travel planning, client comms, accessibility and military/veteran benefits.",
  },
  {
    id: "holdfast",
    label: "Holdfast Cyber",
    short: "HC",
    blurb: "CMMC readiness, assessments, policy drafting and client reporting.",
  },
  {
    id: "fieldcred",
    label: "FieldCred",
    short: "FC",
    blurb: "Credential compliance, product copy, support and onboarding.",
  },
  {
    id: "shared",
    label: "Shared",
    short: "SH",
    blurb: "General-purpose packs that apply across all three businesses.",
  },
];

export const WORKSPACE_IDS = WORKSPACES.map((workspace) => workspace.id);

export function workspaceLabel(id: string): string {
  return WORKSPACES.find((workspace) => workspace.id === id)?.label ?? "Shared";
}

export function isWorkspace(value: unknown): value is WorkspaceId {
  return typeof value === "string" && (WORKSPACE_IDS as string[]).includes(value);
}
