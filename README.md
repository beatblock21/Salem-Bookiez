# PES Bookie

Master League & BAL betting console — team odds engine, live match board, accumulators/SGM, admin settlement desk, and an M-Pesa-style wallet approval flow. Frontend is React (Vite); backend is Supabase (Postgres + Auth + Realtime + RPCs).

> Status: migrated off the original localStorage prototype onto Supabase. See `migration_doc.odt` for the full history of that migration if you need it — not required reading to run the app.

---

## Stack

| Layer      | Tech                                                        |
|------------|-------------------------------------------------------------|
| Frontend   | React + Vite                                                |
| Backend    | Supabase (Postgres, Auth, Realtime, Row-Level Security)     |
| Money logic| Postgres RPCs (`place_bet`, `settle_match_and_payouts`, `cash_out_bet`, `create_wallet_request`, `process_wallet_request`) — nothing balance-related runs client-side |
| Hosting    | Cloudflare Pages                                             |

---

## Prerequisites

- Node.js 18+
- A Supabase project (free tier is fine to start)
- `npm install @supabase/supabase-js` (already a dependency once you run `npm install`)

---

## 1. Database setup

1. Open your Supabase project → **SQL Editor**.
2. Run the schema in `REFERENCE_SQL` top to bottom. It creates:
   - Core tables: `profiles`, `matches`, `bets`, `bet_legs`, `transactions`, `team_profiles`
   - Row-Level Security policies (users only see their own bets/transactions; matches are public-read)
   - The auth trigger that auto-creates a `profiles` row on signup
   - All money-moving RPCs (`place_bet`, `settle_match_and_payouts`, `cash_out_bet`, wallet request/approve)
   - Realtime publication for `profiles` and `matches` (balance + odds updates push to clients without polling)
3. **First admin account**: there is no seeded admin anymore (that was a localStorage-only shortcut). Register a normal account through the app, then in Supabase go to **Table Editor → profiles** and change that row's `role` from `bettor` to `admin`.

---

## 2. Environment variables

Create a `.env.local` (never commit this):

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

- The **anon key** is safe to expose client-side — it's designed to be public and is what RLS policies gate against.
- The **service role key** and **DB password** are not used by the frontend at all and must never be committed, put in `.env.local`, or pasted into any file that goes into the repo.

---

## 3. Local development

```bash
npm install
npm run dev
```

---

## 4. Deploying to Cloudflare Pages

1. Push this repo to GitHub (see the `.gitignore` note below first).
2. In Cloudflare Pages: **Create a project → Connect to Git** → select the repo.
3. Build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. **Environment variables** (Cloudflare Pages → Settings → Environment variables), for both Production and Preview:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy. Cloudflare rebuilds automatically on every push to your connected branch.

### `.gitignore` (make sure this exists before your first commit)
```
node_modules
dist
.env
.env.local
migration_doc.odt
```
(That last line is deliberate — that file has a live credential in it. Delete/rotate the password, keep the doc locally if you want the history, just don't ship it.)

---

## 5. What's in the app

**Bettor side**
- Match Board — 1X2 plus extended markets (BTTS, Total Goals at 3 lines, Asian Handicap with push, HT/FT, Correct Score, Anytime Scorer/Assist)
- Betslip — singles, accumulators, and Same Game Multi (multiple legs on one match); live odds-change detection with accept/reject per leg
- My Bets — bet history, per-leg grading, cash-out (partial settlement before full-time)
- Wallet — deposit/withdrawal requests against M-Pesa reference codes, pending until admin approval
- Settings — password change, notification mute preferences, personal stake limit

**Admin side**
- Dashboard — exposure liability, deposits/withdrawals, per-match worst-case payout breakdown
- Matches — fixture creation with a Poisson/Negative-Binomial odds engine, team-history-aware pricing, settlement desk (two-step confirm), regrade tool for correcting mis-graded bets
- Team Stats — CSV import for aggregated team history (win rates, momentum, volatility) that feeds the odds engine
- Users / Wallets — bettor list, deposit/withdrawal approval queue
- Settings — configurable bookmaker margins per market

**Security model**
- All balance mutations happen inside Postgres RPCs under `SECURITY DEFINER`, not in the browser.
- Admin actions (settlement, wallet approval) re-check the caller's role server-side — the UI role badge is cosmetic, not a security boundary.
- Passwords are handled entirely by Supabase Auth; the app never stores or compares them itself.

---

## 6. Known simplifications (by design, not bugs)

- Push-leg odds recalculation for accumulators isn't implemented — a push leg in an acca is currently treated as void for the whole slip rather than reducing to a 1.0x multiplier, which is the industry-standard approach. Flagged in `REFERENCE_SQL`'s Step 7 comments if you want to build it out later.
- Cash-out uses a static formula (Option A: 85%/90%/weighted-0.75%), not a live-market-reprice model.
- Corners/Cards lines are flat bookmaker-style lines, not probability-derived like the rest of the engine.

---

## License

_Add your license here before making the repo public — MIT is the common default if you don't have a preference._
