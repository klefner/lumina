# Monetization Architecture Decision Record

Records the decided (not just proposed) architecture for taking Lumina from a free beta to a paid
public launch, and the reasoning behind each call. See [`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md) and
[`studio-ops/AGENTS.md`](https://github.com/klefner/studio-ops/blob/main/AGENTS.md) for the surrounding
process this fits into.

## Business structure (decided 2026-07-23)

- Operate as a sole proprietor under the owner's own SSN — standard individual tax reporting, no LLC yet.
- **Trigger to revisit:** revenue exceeding $500/month, sustained for 3 consecutive months. At that point,
  form an LLC. Not before.
- This decision has no technical dependencies — nothing below is blocked by it, and nothing below needs to
  change when the LLC trigger fires.

## Budget constraint (decided 2026-07-23)

The project is being built on essentially no discretionary budget. Every choice below was made against a
hard requirement: **genuinely $0 fixed cost until real revenue exists**, not just "cheap." Marketing is
grassroots/organic (Reddit, X, other social) — no paid acquisition budget, which also reinforces the
web-only platform call below (a shared link has zero install friction; an app-store listing does not).

## Platform: web-only, no app-store wrapper

Stay on GitHub Pages exactly as today for the game itself — no change to how it's served.

**Why:** no $99/yr Apple developer account, no app-review cycles, no 30% App/Play Store cut on top of
Stripe's own fee. Grassroots link-sharing (the actual marketing plan) works natively on the web and not at
all well for "please go install this app." Revisit this alongside the LLC trigger — that's the point where
app-store distribution might start paying for its own overhead.

## Payment processor: Stripe

**Why:** $0 to open, $0/month, nothing charged until an actual sale happens (~2.9% + 30¢ per successful
transaction after that — revenue-proportional, not a fixed cost). Hosted Checkout keeps Lumina completely
out of PCI card-data scope — the game's own code never touches a card number. Explicitly supports
sole-proprietor/individual accounts under an SSN, with correct 1099-K handling if/when volume requires one.
(Verified current as of 2026-07-23 — Stripe pricing can change; re-verify before going live if this record
is more than a few months old.)

## Backend: Cloudflare Workers + D1, five independent modules

Not one monolithic backend — five separately deployable, separately scalable pieces, each with one job:

1. **Checkout Service** — creates a Stripe Checkout session, redirects the player to Stripe's hosted page.
   Stateless.
2. **Webhook Handler** — receives Stripe's "payment confirmed" event, writes the entitlement record.
   Isolated so a burst of purchases never touches anything else.
3. **Entitlement Service** — what the game client calls: "what does this player own?" The hottest, most
   frequently called module (checked on every load) — kept separate so it can get its own caching/scaling
   treatment later without touching the other four.
4. **Identity Service** — lightweight email magic-link auth. Issues a session tying a browser to a player
   record. No passwords to secure, no account-recovery flow to build.
5. **Save-Sync Service** — the free (not paid) multi-save-slots feature lives here, on the same identity
   system as entitlements. Building it alongside identity is far cheaper than solving "how is a player
   identified" twice.

**Client side:** one new isolated module in the game (not woven through `game.js`) calls the Entitlement
Service once on load, caches the result, and gates every cosmetic behind it — the "does the player own this"
question lives in exactly one place.

**Why Cloudflare specifically, over Vercel/AWS Lambda/Supabase, etc.:**
- Workers run at the edge (low latency worldwide — matters for module 3, checked on every load)
- D1 is real relational storage (a player has *many* entitlements and *many* save slots — a join, not a
  flat key-value blob) without running a database server
- **No credit card required to sign up at all.** A card is only needed to pay for usage *beyond* the free
  tier — meaning it is not technically possible to be surprise-billed if no card is ever added. Deliberately
  not adding one until revenue justifies it.

**Free tier, verified 2026-07-23** (re-verify before launch if this record has aged — these numbers change):
- Workers: 100,000 requests/day (~3M/month), no card required
- D1: 5 GB storage, 5M row reads/day, 100K row writes/day
- Total fixed cost of the entire stack before a single sale: **$0**

## Design note: built shareable, not shared (yet)

The five backend modules are generic enough that Holesy (or any future game) could use the same
entitlement/payment system rather than each game growing its own — that sharing was not built in, since it
isn't needed yet, but the module boundaries were chosen with it in mind. Same spirit as `studio-ops`: build
what's needed now, shaped so it doesn't have to be redone later if a second consumer shows up.

## Open, not yet decided

- Exact pricing per monetized feature (music packs, line cosmetics, dot skins, reveal themes, practice pack)
- Final copy/UX for the Identity Service's magic-link flow
- Whether analytics get added on the free-tier stack above, and which tool
