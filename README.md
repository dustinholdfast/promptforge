# PromptForge

PromptForge is an MVP marketplace for production-ready, versioned AI prompt packs and workflows. It demonstrates the complete creator-to-customer loop: publish a pack, discover or acquire it, run it with structured variables, save useful outputs, and track creator performance.

## Included

- Marketplace discovery with category filters and search
- Free and paid pack acquisition
- Premium variable-driven workflow runner with model selection
- Persistent run history and favorites
- Creator publishing flow and basic run/revenue/rating stats
- D1 persistence with Drizzle schema and generated migration
- Responsive UI and accessible interaction states

The current generation route uses a deterministic demo provider so the product works without secrets. The model selector and server route are the integration seam for official OpenAI, Anthropic, and Google SDK adapters. Payments similarly use a demo checkout action in place of Stripe until live account credentials are configured.

## Development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm test
npm run db:generate
```
