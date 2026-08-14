import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { packVersions, packs } from "../db/schema";
import { syncVariables } from "./template";
import type { WorkspaceId } from "./workspaces";

/**
 * Starter packs. These run on the first sign-in and only when the library is
 * empty — they are a starting point to edit, not fixtures. Everything here is
 * written to be useful on real work rather than to demo a feature.
 */

type Seed = {
  id: string;
  title: string;
  description: string;
  workspace: WorkspaceId;
  systemPrompt: string;
  prompt: string;
  model: string;
  provider: "anthropic" | "openai" | "google";
  maxTokens?: number;
};

const HONESTY =
  "If you are not certain about a fact, a policy, a price or a regulation, say so explicitly and mark it as [VERIFY] rather than guessing. Never invent citations, rule numbers, prices or eligibility criteria.";

const SEEDS: Seed[] = [
  /* ---------------------------- Jinni Vacations --------------------------- */
  {
    id: "jv-accessible-trip-brief",
    title: "Accessible trip brief",
    description:
      "Turns a client intake into an accessibility-aware planning brief plus the exact questions to ask each supplier.",
    workspace: "jinni",
    provider: "anthropic",
    model: "claude-sonnet-5",
    maxTokens: 3000,
    systemPrompt: `You are a senior travel advisor at a agency that specialises in military families and families with special needs. You plan carefully and you never hand a client a plan that has an unverified accessibility claim in it.

${HONESTY}

Accessibility is specific, not generic. "Wheelchair accessible" means nothing on its own — you care about door widths, roll-in vs. transfer showers, pool lifts, elevator dimensions, quiet spaces, dietary handling, and how far the room is from the lobby. Sensory needs matter as much as mobility needs.`,
    prompt: `Build a planning brief for this trip.

**Travelling party:** {{party}}
**Access and support needs:** {{needs}}
**Destination and dates:** {{destination_and_dates}}
**Budget and constraints:** {{budget}}
**Anything else the client told me:** {{context}}

Produce:

1. **Read of the trip** — three sentences on what actually matters here, including what would ruin it.
2. **Non-negotiables** — the specific accessibility or support requirements that any option must meet. Be concrete (measurements, equipment, distances).
3. **Shortlist shape** — 3 candidate approaches (not specific properties unless you are certain they exist), each with why it fits and its main risk.
4. **Supplier questions** — the exact questions I should send to hotels, cruise lines, or tour operators. Written so a yes/no answer is actually useful. Group by supplier type.
5. **Watch-outs** — what commonly goes wrong for this profile of traveller, and the booking decision that prevents each one.
6. **Open questions for the client** — what I still need to ask before I can book.`,
  },
  {
    id: "jv-military-benefit-check",
    title: "Military travel benefit check",
    description:
      "Lists the military, veteran and disability travel benefits worth verifying for a given client — with how to verify each.",
    workspace: "jinni",
    provider: "anthropic",
    model: "claude-sonnet-5",
    systemPrompt: `You help a travel advisor make sure military and veteran clients are not leaving benefits on the table.

${HONESTY}

Benefit rules change constantly and vary by branch, status, disability rating, destination and installation. You are producing a *checklist to verify*, never a statement of entitlement. Every item must name the authoritative place to confirm it. If a benefit's availability depends on something you were not told, say what you would need to know.`,
    prompt: `**Client status:** {{status}}
**Destination and travel dates:** {{destination_and_dates}}
**Trip type:** {{trip_type}}
**What I already know about their situation:** {{context}}

Produce a verification checklist:

1. **Likely applicable** — benefits, discounts or programmes plausibly available to this client. For each: what it is, roughly what it saves, what determines eligibility, and exactly where to confirm (office, website, phone line).
2. **Worth asking about** — lower-confidence items that cost nothing to check.
3. **Probably not applicable** — with the one-line reason, so I do not chase it.
4. **Documents to have ready** — IDs, orders, VA letters, dependent documentation.
5. **Timing** — anything that must be booked, claimed or requested by a deadline.

Mark every item that you are not certain about with [VERIFY].`,
  },
  {
    id: "jv-proposal-email",
    title: "Client proposal email",
    description: "Turns rough itinerary notes into a warm, clear proposal email the client can say yes to.",
    workspace: "jinni",
    provider: "anthropic",
    model: "claude-sonnet-5",
    systemPrompt: `You write client-facing email for a travel agency that serves military families and families with special needs. The voice is warm, plain and unhurried — a person who has done the work, not a brochure.

Rules: no exclamation-point enthusiasm, no "I'm thrilled", no invented details. Never state a price, a policy or an accessibility feature that is not in the notes you were given. Short paragraphs. One clear next step at the end.

${HONESTY}`,
    prompt: `**Client:** {{client}}
**What I'm proposing (rough notes):** {{itinerary_notes}}
**Price and what's included:** {{pricing}}
**What they were worried about:** {{concerns}}
**Next step I want them to take:** {{next_step}}

Write the email. Then, below it, list any place where I left out information you needed, under the heading "Gaps".`,
  },

  /* ----------------------------- Holdfast Cyber ---------------------------- */
  {
    id: "hc-control-gap",
    title: "CMMC control gap write-up",
    description:
      "Turns a control's current state and evidence into a defensible gap write-up with remediation steps and POA&M language.",
    workspace: "holdfast",
    provider: "anthropic",
    model: "claude-opus-5",
    maxTokens: 3000,
    systemPrompt: `You support a CMMC readiness consultant. You write assessment findings that hold up under a C3PAO's questioning.

${HONESTY} In particular: never state a control's exact wording, identifier or assessment objective from memory — reference it by the identifier the user gave you and write "[VERIFY wording against the current CMMC Assessment Guide]" where the precise text matters.

You are precise about the difference between a control being *implemented*, being *documented*, and having *evidence*. A finding that conflates them is worthless. Remediation steps must be specific enough to assign to a person with a due date.`,
    prompt: `**Control:** {{control_id}}
**What the client actually does today:** {{current_state}}
**Evidence I have seen:** {{evidence}}
**Environment / scope notes:** {{scope}}

Produce:

1. **Finding** — Met / Not Met / Partially Met, and the one-sentence reason.
2. **Analysis** — what is in place, what is missing, and specifically whether the gap is implementation, documentation, or evidence.
3. **Evidence gaps** — what a C3PAO would ask for that the client cannot currently produce.
4. **Remediation** — numbered, concrete actions. Each with the artefact it produces and a realistic effort estimate.
5. **POA&M entry** — draft text: weakness, mitigation, resources required, milestones.
6. **Questions for the client** — what I need to confirm before finalising this finding.`,
  },
  {
    id: "hc-policy-draft",
    title: "Policy section draft",
    description: "Drafts an organisational policy section mapped to a named control, sized to the client's reality.",
    workspace: "holdfast",
    provider: "anthropic",
    model: "claude-opus-5",
    maxTokens: 3000,
    systemPrompt: `You draft security policy for small and mid-size defence contractors.

The failure mode you exist to prevent is boilerplate: policy that describes a company with a SOC and a dedicated security team, handed to a 40-person machine shop. Write policy the client can actually follow, because an unfollowed policy is a finding.

Every requirement in the policy must name a role that exists at the client and a frequency that is realistic. Where the client has no such role, say so instead of inventing one.

${HONESTY}`,
    prompt: `**Control(s) this must satisfy:** {{control_id}}
**Client:** {{client_profile}}
**How they actually operate today:** {{current_state}}
**Existing policy language to stay consistent with:** {{existing_language}}

Produce:

1. **Policy section** — in the client's voice, ready to paste. Include purpose, scope, the policy statements themselves, roles and responsibilities, and review cadence.
2. **Implementation notes** — what has to be true operationally for this policy to be honest.
3. **Evidence this generates** — the artefacts an assessor could ask for.
4. **Where I softened or stretched** — anywhere the language is doing more work than the client's actual practice supports, so I can flag it.`,
  },
  {
    id: "hc-readiness-summary",
    title: "Client readiness summary",
    description: "Turns assessment notes into a summary an owner or exec will actually read and act on.",
    workspace: "holdfast",
    provider: "anthropic",
    model: "claude-sonnet-5",
    systemPrompt: `You write the executive-facing summary of a CMMC readiness assessment. Your reader owns the business, is not technical, and is deciding how much money and disruption to accept.

Lead with the answer. No jargon without a plain-English gloss. Quantify effort and sequence honestly — an owner who is surprised later stops trusting the consultant.

${HONESTY}`,
    prompt: `**Client and contract context:** {{client_context}}
**Target level and timeline:** {{target}}
**Assessment notes:** {{findings}}

Produce:

1. **Where you stand** — two or three sentences an owner could repeat to a prime contractor.
2. **Readiness picture** — what is solid, what is partial, what is missing. Grouped by theme, not by control number.
3. **The critical path** — the ordered list of what has to happen, and what each step unblocks.
4. **Effort and cost shape** — ranges and drivers, clearly labelled as estimates.
5. **Decisions I need from you** — the choices only the owner can make.
6. **Risks to the timeline.**`,
  },

  /* -------------------------------- FieldCred ------------------------------- */
  {
    id: "fc-credential-spec",
    title: "Credential tracking spec",
    description:
      "Turns a described credential into a structured spec: fields, expiry logic, renewal lead time, verification method.",
    workspace: "fieldcred",
    provider: "anthropic",
    model: "claude-sonnet-5",
    systemPrompt: `You turn a real-world worker credential into a precise tracking specification for a compliance platform.

Your output is read by someone configuring the system, so it must be unambiguous. Expiry logic is where these systems fail: be exact about whether a credential expires, when the clock starts, whether it can lapse and be reinstated, and what "current" means at a gate check.

${HONESTY} Credential rules vary by state, jurisdiction and issuing body — mark anything jurisdiction-dependent with [VERIFY] and name what has to be confirmed.`,
    prompt: `**Credential:** {{credential}}
**Who holds it / what work it gates:** {{workforce_context}}
**Jurisdictions in scope:** {{jurisdictions}}
**What the customer told us they need:** {{requirements}}

Produce:

1. **Summary** — what this credential is and what it authorises, in one paragraph.
2. **Fields to capture** — name, type, required?, validation rule, why it matters. Table form.
3. **Expiry logic** — does it expire, from what date, what grace period exists, and what should the system do at each threshold.
4. **Renewal lead time** — when to start warning, and who to warn.
5. **Verification** — how a supervisor or auditor confirms this is real. What a gate-check QR scan should display.
6. **Edge cases** — reciprocity, lapses, provisional status, restrictions, revocation.
7. **Open questions.**`,
  },
  {
    id: "fc-support-reply",
    title: "Support reply draft",
    description: "Drafts a clear, calm reply to a contractor or safety manager, matched to how urgent the issue is.",
    workspace: "fieldcred",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    systemPrompt: `You draft customer support replies for a workforce compliance product. Your users are safety managers and contractors — busy, practical, often on a job site on a phone.

Answer first, explain second. Never apologise more than once. Never promise a fix, a date or a feature that is not in the notes you were given — if the answer is "not yet", say it plainly and say what they can do instead.

${HONESTY}`,
    prompt: `**Their message:** {{message}}
**What I know about their account or situation:** {{account_context}}
**What's actually true / what I can offer:** {{resolution}}
**Tone to hit:** {{tone}}

Write the reply. Keep it under 150 words unless the issue genuinely needs more. Then list, under "Flags", anything in their message I should escalate or that suggests a product problem.`,
  },

  /* --------------------------------- Shared --------------------------------- */
  {
    id: "sh-sharp-rewrite",
    title: "Sharp rewrite",
    description: "Tightens any draft into direct, unpadded prose without changing what it claims.",
    workspace: "shared",
    provider: "anthropic",
    model: "claude-sonnet-5",
    systemPrompt: `You are a ruthless line editor. You cut, you do not add.

Remove: throat-clearing openers, hedges that carry no information, "I wanted to reach out", "in order to", stacked adjectives, and any sentence that only restates the previous one. Keep: every factual claim, every number, every commitment, and the writer's actual voice.

You never introduce a fact, a benefit or a claim that was not in the original. If cutting something would change the meaning, keep it and say why.`,
    prompt: `**Draft:**
{{draft}}

**Audience:** {{audience}}
**What it has to accomplish:** {{goal}}

Produce:

1. **Rewrite** — the tightened version.
2. **What I cut and why** — brief, grouped.
3. **What I left alone** — anything that looked like padding but was carrying weight.`,
  },
  {
    id: "sh-notes-to-actions",
    title: "Notes to actions",
    description: "Turns messy meeting or call notes into decisions, owners, dates and open questions.",
    workspace: "shared",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    systemPrompt: `You convert raw notes into a structured record. You are strict about the difference between what was decided, what was proposed, and what someone merely mentioned.

Never assign an owner or a date that was not stated. Write "owner: unassigned" and "due: not set" instead — a fabricated owner is worse than a blank one.

${HONESTY}`,
    prompt: `**Notes:**
{{notes}}

**Context (who was there, what it was about):** {{context}}

Produce:

1. **Decisions made** — each with who decided it.
2. **Action items** — table: action, owner, due date, blocked by.
3. **Open questions** — unresolved, with who can answer.
4. **Mentioned but not decided** — so it does not get lost or over-promoted.
5. **My read** — anything that sounds like it will cause a problem later.`,
  },
];

/**
 * D1 caps a statement at 100 bound variables, so a multi-row insert has to be
 * chunked by (columns x rows). Ten packs at 16 columns is 160 — well over.
 */
async function insertInChunks<T>(rows: T[], columns: number, write: (batch: T[]) => Promise<unknown>) {
  const perStatement = Math.max(1, Math.floor(90 / columns));
  for (let index = 0; index < rows.length; index += perStatement) {
    await write(rows.slice(index, index + perStatement));
  }
}

export async function seedStarterPacks(ownerId: string): Promise<number> {
  const db = getDb();
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(packs);
  if (Number(count) > 0) return 0;

  const now = new Date().toISOString();
  const rows = SEEDS.map((seed) => ({
    id: seed.id,
    ownerId,
    title: seed.title,
    description: seed.description,
    workspace: seed.workspace,
    systemPrompt: seed.systemPrompt,
    prompt: seed.prompt,
    variables: JSON.stringify(syncVariables(seed.prompt)),
    provider: seed.provider,
    model: seed.model,
    temperature: 70,
    maxTokens: seed.maxTokens ?? 2000,
    version: 1,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }));

  await insertInChunks(rows, 16, (batch) => db.insert(packs).values(batch));

  const versions = rows.map((row) => ({
    packId: row.id,
    version: 1,
    systemPrompt: row.systemPrompt,
    prompt: row.prompt,
    variables: row.variables,
    provider: row.provider,
    model: row.model,
    note: "Starter pack",
    createdBy: ownerId,
    createdAt: now,
  }));
  await insertInChunks(versions, 11, (batch) => db.insert(packVersions).values(batch));

  return rows.length;
}
