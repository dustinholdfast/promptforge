# PromptForge

An internal prompt library. Prompts you have already tuned live here as
**packs**: a system prompt, a template with `{{variables}}`, a model, and a
version history. Anyone on the team signs in, fills in the inputs, and runs the
pack against a real model. Every run is kept.

It is not a marketplace. There is no pricing, no checkout and no public
catalogue — the earlier prototype had all three and they have been removed.

## What's here

| Area | Status |
| --- | --- |
| Accounts, sessions, sign-in | Real. PBKDF2 password hashes, HttpOnly session cookies in D1. |
| Model calls | Real. Streaming Anthropic / OpenAI / Gemini over `fetch`. |
| Packs | Create, edit, duplicate, archive. Editing the prompt writes a new version; you can restore any earlier one. |
| Run history | Every run persisted with output, token counts, latency, and the error if it failed. |
| Workspaces | Packs are filed under Jinni Vacations, Holdfast Cyber, FieldCred or Shared. |

Ten starter packs are seeded on first sign-in — three for Jinni, three for
Holdfast, two for FieldCred, two shared. They are a starting point to edit, not
fixtures.

## Setup

Requires Node 22.13+.

```bash
npm install
cp .dev.vars.example .dev.vars   # then paste in at least one API key
npm run dev
```

Open the app and create an account. **The first account created becomes the
owner.** After that, signup is closed unless you set `SIGNUP_INVITE_CODE` in
`.dev.vars` — anyone with that code can then create a member account.

### Keys

`.dev.vars` is git-ignored and is read by Wrangler in local dev:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
SIGNUP_INVITE_CODE=some-shared-string
```

You need at least one. Models belonging to a provider with no key are shown
greyed out rather than failing mid-run.

In production these are Worker secrets:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

### Database

D1, via the `DB` binding declared in `.openai/hosting.json`. Tables are created
on first request by `db/ensure.ts`, so **there is no migration step to run**.

`db/schema.ts` (Drizzle) and `db/ensure.ts` (raw DDL) describe the same tables —
keep them in step when you change one. `npm run db:generate` writes drizzle-kit
SQL into `drizzle/` if you ever want it, but that output is git-ignored: having
a committed migration history *and* runtime DDL is two sources of truth, and at
this size the runtime one is enough.

If you are upgrading from the prototype, the old `packs` and `runs` tables are
renamed to `packs_legacy_v0` / `runs_legacy_v0` on first boot rather than being
dropped. Delete them by hand once you are satisfied nothing was lost. The old
`purchases` table is left untouched and is no longer read.

## Working on it

```bash
npm test        # unit tests, no network or API key needed
npm run lint
npm run build
npm run check   # all three
```

The tests cover the parts most likely to break silently: template rendering and
variable syncing, the SSE parser (including chunk boundaries mid-UTF-8), each
provider's wire format, and password hashing.

## Layout

```
app/
  page.tsx              server component — session gate, loads initial data
  login.tsx             sign in / first-run owner setup
  prompt-forge-app.tsx  shell: library, history, modals
  components/           runner (streaming), editor (+versions), markdown
  api/auth|packs|runs|generate
lib/
  auth.ts       sessions, sign-up/in, upstream identity headers
  password.ts   PBKDF2 over WebCrypto
  providers.ts  Anthropic / OpenAI / Gemini adapters + SSE parsing
  template.ts   {{variable}} extraction and rendering
  models.ts     the model catalogue — update model IDs here
  library.ts    shared read paths for the page and the API
  seed.ts       starter packs
db/
  schema.ts, ensure.ts  Drizzle schema and runtime DDL
```

## Two things to know

**Model IDs go stale.** `lib/models.ts` is the only place they appear. They were
checked against provider docs in August 2026; a "model not found" error means
that list needs updating, not that the adapter is broken.

**Login costs CPU.** Password hashing is 210,000 PBKDF2 rounds. That is correct
for security but is more than the Cloudflare Workers *free* plan's 10ms CPU
budget. On a paid plan it is fine; on the free plan, lower `ITERATIONS` in
`lib/password.ts` (and re-create accounts, since the count is stored per hash).

## Not done yet

- No password reset — the owner would have to clear the row in D1.
- No admin screen for users; roles exist in the schema but nothing enforces
  `owner` beyond the first-account bootstrap.
- Archived packs can be archived but not un-archived from the UI (the API
  supports `restore`).
- Token counts are whatever the provider reports; there is no cost calculation.
