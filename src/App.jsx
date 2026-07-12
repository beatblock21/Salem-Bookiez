import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { createClient } from "@supabase/supabase-js";

// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
// SUPABASE CLIENT
// The publishable/anon key is SAFE to expose client-side — it's designed to
// be public (this is not the service role key, not the DB password).
// UPDATED (CHANGE 021): now reads from Vite's import.meta.env instead of a
// hardcoded literal, matching the VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// already set in .env.local. Deliberately no hardcoded fallback — if these
// are ever missing/misconfigured this should fail loudly and immediately,
// not silently keep working off a stale key if it's ever rotated later.
// Requires `@supabase/supabase-js` installed (npm install @supabase/supabase-js
// if not already a dependency).
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
// DB & PERSISTENCE LAYER
// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
const DB_KEY = "pes_bookie_db";

const getDB = () => {
  try {
    const d  = JSON.parse(localStorage.getItem(DB_KEY)) || {};
    const db = { users: {}, transactions: [], matches: [], bets: [], ...d };

    // MIGRATION: self-heal matches whose odds object predates the flat
    // sub-market keys (btts_yes, corners_over, score_2_1...). Without this,
    // those matches resolve match.odds[outcome] to undefined for any
    // non-1X2 pick, which every lookup site defaults to 1 — locking the
    // betslip at 1.00 odds for that leg even though the cell shows a real
    // number. Runs once per load; only writes back if something changed.
    let migrated = false;
    db.matches = (db.matches || []).map(m => {
      if (!m.odds) return m;
      const o = { ...m.odds };
      const old = m.odds;

      if (o.btts_yes === undefined && old.btts) {
        o.btts_yes = old.btts.yes; o.btts_no = old.btts.no; migrated = true;
      }
      if (o.corners_over === undefined && old.corners) {
        o.corners_over = old.corners.over; o.corners_under = old.corners.under;
        o._cornerLine = old.corners.line; migrated = true;
      }
      if (o.cards_over === undefined && old.cards) {
        o.cards_over = old.cards.over; o.cards_under = old.cards.under;
        o._cardLine = old.cards.line; migrated = true;
      }
      if (o.correctScores) {
        Object.entries(o.correctScores).forEach(([k, v]) => {
          const flatKey = `score_${k.replace("-", "_")}`;
          if (o[flatKey] === undefined) { o[flatKey] = v; migrated = true; }
        });
      }
      return migrated ? { ...m, odds: o } : m;
    });
    if (migrated) saveDB(db);

    return db;
  } catch {
    return { users: {}, transactions: [], matches: [], bets: [] };
  }
};

const saveDB = (db) => localStorage.setItem(DB_KEY, JSON.stringify(db));

// Seed the admin account once on first load; idempotent — never overwrites existing data
const seedDB = () => {
  const db = getDB();
  if (!db.users["admin"]) {
    db.users["admin"] = {
      uid: "admin",
      email: "admin@pes.local",
      password: "admin123",
      name: "The Bookie",
      role: "admin",
      balance: 0,
      createdAt: Date.now(),
    };
    saveDB(db);
  }
};
seedDB();

// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
// NEW: MAX STAKE CONSTANT — single place to change the per-bet maximum.
// BetslipBasket checks against this before confirming a bet, mainly to guard
// against an accidental fat-finger stake (e.g. an extra zero typed in).
// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
const MAX_STAKE = 10000;

// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
// NEW: MIN DEPOSIT CONSTANT — smallest deposit request a bettor can submit.
// Set to KES 10, matching M-Pesa's practical minimum for a real transaction.
// BettorWallet checks against this before a deposit request is created, so a
// request for an amount that couldn't correspond to a real M-Pesa transfer
// never reaches the admin's approval queue. Withdrawal has no separate
// minimum — it's already bounded by the bettor's actual wallet balance.
// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
const MIN_DEPOSIT = 10;

// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
// DESIGN TOKENS
// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
const C = {
  bg:          "#0a0f1e",
  surface:     "#111827",
  card:        "#1a2235",
  border:      "#1e2d45",
  accent:      "#c8313f",
  accentDim:   "#a82733",
  red:         "#ff4d6d",
  yellow:      "#ffd166",
  blue:        "#4da6ff",
  purple:      "#b47aff",
  text:        "#e8edf5",
  muted:       "#6b7a99",
  win:         "#00e5a0",
  loss:        "#ff4d6d",
  // UI POLISH: supplementary tokens — all additive, every token above unchanged.
  // These give surfaces depth so the app reads less like a flat wireframe.
  cardHover:   "#212c44",
  borderHover: "#2a3b5c",
  // Background gradient: very subtle, lightens slightly at the top so the
  // page feels lit rather than just black.
  bgGradient:   "radial-gradient(ellipse 120% 60% at 50% 0%, #0f1628 0%, #0a0f1e 70%)",
  // Card gradient: adds a slight top-catch so stacked cards have the illusion
  // of a light source above rather than being flat fills.
  cardGradient: "linear-gradient(160deg, #1e2a42 0%, #161e34 100%)",
  // Nav slightly warmer than the page background so it reads as a separate layer.
  navGradient:  "linear-gradient(180deg, #131c30 0%, #111827 100%)",
  // Glow for the accent color — used on logo text and active/selected states.
  
 accentGlow:   "0 0 20px rgba(200,49,63,0.12), 0 0 1px rgba(200,49,63,0.3)",
  // Card shadow: creates depth between card and background.
  cardShadow:   "0 2px 12px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.03) inset",
  // Elevated shadow for floating elements (betslip, modals).
  cardShadowLg: "0 8px 32px rgba(0,0,0,0.45)",
  // Primary button glow.
  btnGlow:      "0 0 16px rgba(200,49,63,0.25)",
};

const styles = {
  app: {
    minHeight: "100vh",
    // UI POLISH: subtle radial gradient so the background has depth — top of
    // the page is fractionally lighter than the edges, giving a lit-from-above
    // feel without changing the dark navy color scheme.
    background: C.bgGradient,
    color: C.text,
    fontFamily: "'Inter','Segoe UI',sans-serif",
    fontSize: 15,
  },
  nav: {
    // UI POLISH: gradient + shadow so the navbar reads as a separate elevated
    // layer rather than just a border line floating on the same background.
    background: C.navGradient,
    borderBottom: `1px solid ${C.border}`,
    padding: "0 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 56,
    position: "sticky",
    top: 0,
    zIndex: 100,
    boxShadow: `0 1px 0 ${C.border}, 0 4px 20px rgba(0,0,0,0.4)`,
    backdropFilter: "blur(8px)",
  },
  logo: {
    fontWeight: 800,
    fontSize: 18,
    letterSpacing: "-0.5px",
    color: C.accent,
    display: "flex",
    alignItems: "center",
    gap: 8,
    // UI POLISH: accent glow on the logo text — the one place in the nav
    // that should have presence, gives it a slight "lit" quality.
    textShadow: "0 0 20px rgba(0,229,160,0.4), 0 0 40px rgba(0,229,160,0.15)",
  },
  badge: (color) => ({
    background: color + "18",
    color,
    border: `1px solid ${color}44`,
    borderRadius: 6,
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    // UI POLISH: very subtle matching glow so badges feel like lit indicators
    // rather than flat colored rectangles.
    boxShadow: `0 0 8px ${color}22`,
  }),
  btn: (variant = "primary", size = "md") => ({
    background:
      variant === "primary" ? C.accent
      : variant === "danger"  ? C.red
      : variant === "yellow"  ? C.yellow
      : "transparent",
    color:
      variant === "ghost"   ? C.text
      : variant === "yellow" ? C.bg
      : C.bg,
    border:    variant === "ghost" ? `1px solid ${C.border}` : "none",
    borderRadius: 8,
    padding:   size === "sm" ? "6px 12px" : "9px 18px",
    fontWeight: 700,
    fontSize:   size === "sm" ? 12 : 13,
    cursor:     "pointer",
    letterSpacing: 0.3,
    display:   "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    // UI POLISH: smooth transition for any interactive state change, plus a
    // glow on the primary button so it reads as the clear CTA rather than
    // just another colored rectangle.
    transition: "opacity 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease",
    boxShadow:
      variant === "primary" ? C.btnGlow
      : variant === "danger"  ? "0 0 12px rgba(255,77,109,0.2)"
      : "none",
  }),
  input: {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 14px",
    color: C.text,
    fontSize: 14,
    width: "100%",
    // UI POLISH: replaced bare outline:none with a focus-visible ring using
    // the accent color. Previously inputs were completely invisible when
    // focused — standard accessibility issue, now fixed visually.
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  },
  card: {
    // UI POLISH: gradient fill + shadow so cards have depth and feel like
    // they're floating slightly above the background rather than being
    // painted flat onto it.
    background: C.cardGradient,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 20,
    boxShadow: C.cardShadow,
    transition: "box-shadow 0.2s ease",
  },
  label: {
    fontSize: 11,
    color: C.muted,
    fontWeight: 700,
    // UI POLISH: slightly tighter tracking — uppercase labels with wide
    // tracking read as decorative rather than informational at 14px; 11px
    // with tighter tracking reads crisper.
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
    display: "block",
  },
  page: {
    maxWidth: 960,
    margin: "0 auto",
    padding: "28px 20px",
  },
};

// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
// UTILITIES
// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
const fmt    = (n) => `KES ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;
const ts     = (t) => new Date(t).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
const fmtOdds = (o) => Number(o).toFixed(2);

// NEW (CHANGE 004): normalizes a team name for team_profiles lookups — must
// mirror aggregate_team_profiles.py's normalize_team() exactly (uppercase,
// ensure trailing " FC") or a typed team name silently fails to match its
// aggregated row and the odds engine falls back to manual-only mode.
const normalizeTeamName = (name) => {
  const upper = (name || "").trim().toUpperCase();
  if (!upper) return "";
  return upper.endsWith(" FC") ? upper : upper + " FC";
};

// NEW (CHANGE 007): inverse of the create-fixture form's kickoff handling.
// The form sends `new Date(datetimeLocalValue).toISOString()` (interprets
// the input's value as local time, stores as UTC). To pre-fill the edit
// form correctly, this must go back to a local-time string using local
// getters — using toISOString() directly here would silently shift the
// displayed kickoff by the browser's UTC offset.
const toDatetimeLocalValue = (ms) => {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// NEW: turns a raw outcome key into a readable label for betslip/history display.
const RESULT_SYM = { home: "1", draw: "X", away: "2" };
// NEW: derives the market_type category needed by Supabase's place_bet RPC
// and settle_match_and_payouts grading logic, from the same flat outcome-key
// strings formatOutcomeLabel already parses for display. The schema's
// settlement function branches on market_type ('1X2', 'BTTS', 'HANDICAP',
// etc.) to know HOW to grade a leg — it can't grade from the raw selection
// string alone. This bridges the frontend's existing flat-key convention to
// the schema's market_type column without requiring any UI rework.
function deriveMarketType(outcomeKey) {
  // REVERTED — the new live schema's settle_match_and_payouts grades every
  // one of these market types (confirmed from the deployed function's own
  // CASE statement), so the "*_UNGRADED" labels from the old-schema session
  // no longer apply. Back to the original full mapping.
  if (outcomeKey === "home" || outcomeKey === "draw" || outcomeKey === "away") return "1X2";
  if (outcomeKey === "btts_yes" || outcomeKey === "btts_no") return "BTTS";
  if (/^total_(\d+_\d+_)?(over|under)$/.test(outcomeKey)) return "TOTAL_GOALS";
  if (outcomeKey === "corners_over" || outcomeKey === "corners_under") return "CORNERS";
  if (outcomeKey === "cards_over"   || outcomeKey === "cards_under")   return "CARDS";
  if (outcomeKey.startsWith("handicap_")) return "HANDICAP";
  if (outcomeKey.startsWith("score_"))    return "CORRECT_SCORE";
  if (outcomeKey.startsWith("htft_"))     return "HT_FT";
  if (outcomeKey.startsWith("scorer_"))   return "SCORER";
  if (outcomeKey.startsWith("assist_"))   return "ASSIST";
  return "UNKNOWN"; // settlement leaves unrecognised market types pending rather than wrongly grading them lost
}

function formatOutcomeLabel(outcomeKey) {
  if (outcomeKey === "home" || outcomeKey === "draw" || outcomeKey === "away") {
    return outcomeKey.toUpperCase();
  }
  if (outcomeKey === "btts_yes")  return "GG — BOTH SCORE";
  if (outcomeKey === "btts_no")   return "NG — CLEAN SHEET";
  if (outcomeKey === "total_over")  return "OVER TOTAL GOALS";
  if (outcomeKey === "total_under") return "UNDER TOTAL GOALS";
  // NEW: alternate total goals lines, e.g. "total_1_5_over" -> "OVER 1.5 GOALS"
  if (/^total_\d+_\d+_(over|under)$/.test(outcomeKey)) {
    const m = outcomeKey.match(/^total_(\d+)_(\d+)_(over|under)$/);
    return `${m[3].toUpperCase()} ${m[1]}.${m[2]} GOALS`;
  }
  if (outcomeKey === "corners_over")  return "OVER CORNERS";
  if (outcomeKey === "corners_under") return "UNDER CORNERS";
  if (outcomeKey === "cards_over")    return "OVER CARDS";
  if (outcomeKey === "cards_under")   return "UNDER CARDS";
  // NEW: handicap outcomes, e.g. "handicap_main_home" -> "HANDICAP HOME"
  if (outcomeKey.startsWith("handicap_")) {
    const parts = outcomeKey.split("_"); // ["handicap", slot, side]
    const side = parts[2];
    return `HANDICAP ${side.toUpperCase()}`;
  }
  if (outcomeKey.startsWith("score_")) {
    return "SCORE " + outcomeKey.replace("score_", "").replace("_", "-");
  }
  if (outcomeKey.startsWith("htft_")) {
    const [, h, f] = outcomeKey.split("_");
    return `HT/FT ${RESULT_SYM[h]}/${RESULT_SYM[f]}`;
  }
  if (outcomeKey.startsWith("scorer_home_")) return outcomeKey.replace("scorer_home_", "") + " TO SCORE";
  if (outcomeKey.startsWith("scorer_away_")) return outcomeKey.replace("scorer_away_", "") + " TO SCORE";
  if (outcomeKey.startsWith("assist_home_")) return outcomeKey.replace("assist_home_", "") + " TO ASSIST";
  if (outcomeKey.startsWith("assist_away_")) return outcomeKey.replace("assist_away_", "") + " TO ASSIST";
  return outcomeKey.toUpperCase();
}

// REVERTED (Session 8) — the previous fix here targeted an OLD live schema
// (scheduled/live/completed/cancelled). That schema has since been replaced:
// a new "CORRECTED & COMPLETE" schema.sql is now actually deployed, and its
// matches.status CHECK is back to ('open','locked','settled','cancelled') —
// matching the app's original vocabulary exactly. So the keys revert to what
// they always were. 'upcoming' now has a real purpose again too, in principle
// (though createMatch still inserts matches directly as 'open').
const STATUS = {
  upcoming:  { label: "Upcoming",  color: C.blue },
  open:      { label: "Open",      color: C.accent },
  locked:    { label: "Locked",    color: C.yellow },
  settled:   { label: "Settled",   color: C.muted },
  cancelled: { label: "Cancelled", color: C.red },
};

const MODE_LABELS = { ml: "Master League", bal: "BAL" };

// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
// NEW: tracks live viewport width via a resize listener. BetslipBasket uses
// this to switch between the desktop right-side panel and a full-width
// mobile bottom sheet at a 640px breakpoint.
// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1024);
  useEffect(() => {
    const handle = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);
  return width;
}

// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
// ODDS ENGINE
// FIX: The original file declared two separate `suggestOdds` functions — one
// that accepted (homeRating, awayRating, homeForm, awayForm) at the top and a
// second, more capable one that accepted ({att,mid,def,form}, ...) further
// down.  The second definition silently shadowed the first in JS, meaning the
// first was dead code, but AdminMatches called the second correctly while
// BetslipBasket accessed `match.odds[item.outcome]` which expected a flat
// object instead of the nested `{ match, btts, corners, cards, correctScores }`
// tree the engine returned.
//
// Resolution: keep only the upgraded engine; rename `match` → `mainLine` in
// the return value so `match.odds.home / draw / away` still works at call sites
// that spread the result directly onto the stored match object (see createMatch).
//
// UPGRADE (this pass): tightened rating-gap sensitivity per request — see
// xG coefficients below — and added Total Goals, HT/FT, a properly
// Poisson-derived Correct Score grid, and roster-driven Anytime Scorer /
// Assist markets. Every market now computes TRUE (no-margin) probabilities
// first, then applies margin as one clean multiplicative pass at the end —
// this guarantees the realized overround always lands exactly on the target
// instead of drifting unpredictably the way the old per-outcome
// `margin / probability` approach did.
// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────

// Small local Poisson helper — used by Total Goals and Correct Score, which
// both need P(exactly k goals | expected rate lambda).
function poissonPMF(k, lambda) {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return Math.pow(lambda, k) * Math.exp(-lambda) / fact;
}

// NEW (CHANGE 003): Negative Binomial PMF — same "expected goals" concept
// as Poisson but with an extra parameter `r` (dispersion) that controls
// how spread-out the distribution is around that same mean. Large r
// behaves almost identically to Poisson (tight spread); small r keeps the
// same average goals but produces a much wider scoreline spread — real
// chance of 0-0 AND real chance of 3-3 for a genuinely chaotic matchup,
// instead of everything clustering tightly around the mean the way plain
// Poisson always forces. This is what lets team_profiles.volatility_index
// actually reshape the odds, not just shift them.
// Uses the falling-factorial form of the binomial coefficient
// (Γ(k+r)/(k!·Γ(r)) = product of (r+i)/(i+1) for i in [0,k)) so `r` can be
// any positive real number — no full Gamma function implementation needed.
function negBinomPMF(k, mean, r) {
  const p = r / (r + mean);
  let coeff = 1;
  for (let i = 0; i < k; i++) coeff *= (r + i) / (i + 1);
  return coeff * Math.pow(p, r) * Math.pow(1 - p, k);
}

// Applies a single global margin scalar to a list of {key, p} fair
// probabilities so the resulting odds set's overround lands exactly on
// `targetOverround` (e.g. 1.05 = 5%, 1.32 = 32%). Returns {key: odds}.
// FIX: replaces the old per-outcome `margin / p` pattern, which was both
// mathematically backwards (produced an UNDERROUND, see prior fix) and,
// for multi-outcome markets like scorer props, compounded unpredictably
// when applied independently per outcome instead of once across the set.
function applyMargin(fairList, targetOverround, oddsFloor = 1.01, oddsCeil = 150) {
  const sumP = fairList.reduce((acc, f) => acc + f.p, 0);
  const k = targetOverround / sumP; // scalar that hits the target exactly
  const out = {};
  fairList.forEach(f => {
    const fairOdds = 1 / f.p;
    out[f.key] = Math.min(oddsCeil, Math.max(oddsFloor, +(fairOdds / k).toFixed(2)));
  });
  return out;
}

function suggestOdds(homeStats, awayStats, roster = { home: [], away: [] }, homeProfile = null, awayProfile = null, marginConfig = null) {
  // NEW (CHANGE 019): admin-configurable bookmaker margins. Defaults here
  // are the exact values that were previously hardcoded at each call
  // site below — a caller that passes no marginConfig (or an empty one)
  // gets byte-for-byte the same behavior as before this change.
  const M = {
    main_line: 1.05, btts: 1.05, total_goals: 1.06, handicap: 1.05,
    ht_ft: 1.30, correct_score: 1.32, scorer: 1.45, assist: 1.50,
    ...marginConfig,
  };

  const hAtt  = +homeStats.att  || 75, hMid = +homeStats.mid || 75,
        hDef  = +homeStats.def  || 75, hForm = +homeStats.form || 3;
  const aAtt  = +awayStats.att  || 75, aMid = +awayStats.mid || 75,
        aDef  = +awayStats.def  || 75, aForm = +awayStats.form || 3;

  // NEW (CHANGE 003): clamp helper for the small factor adjustments below —
  // separate from the probability clamp() further down, which operates on
  // a different range (0.01-0.95).
  const clampFactor = (v, cap) => Math.max(-cap, Math.min(cap, v));

  const HOME_LEAGUE_AVG = 1.35; // same anchor as the old flat constant — preserves
  const AWAY_LEAGUE_AVG = 1.25; // legacy behaviour exactly when neither team has data
  const TACTICAL_CAP    = 0.20; // manual att/mid dial: max +/-20% fine-tune on a data baseline
  const MOMENTUM_CAP     = 0.35; // momentum: max +/-35% swing at a maxed-out streak

  // ── ATTACK / DEFENSE FACTORS — data-driven when available, per team ────
  // Each factor is independent of the other side, so a match can legitimately
  // blend one team's real history with the other team's manual-only rating
  // (agreed: fallback to manual applies "for that team only", not the whole
  // match). Neutral factor = 1.0 (average attack / average defense).
  let homeAttackFactor;
  if (homeProfile && homeProfile.home_goals_for != null) {
    const dataFactor = homeProfile.home_goals_for / HOME_LEAGUE_AVG;
    const tacticalDelta = clampFactor((hAtt - 75) * 0.006 + (hMid - 75) * 0.002, TACTICAL_CAP);
    homeAttackFactor = dataFactor * (1 + tacticalDelta);
  } else {
    homeAttackFactor = hAtt / 75; // no data for this team — manual rating IS the baseline
  }

  let awayDefenseFactor;
  if (awayProfile && awayProfile.away_goals_against != null) {
    const dataFactor = awayProfile.away_goals_against / AWAY_LEAGUE_AVG;
    const tacticalDelta = clampFactor((aMid - 75) * -0.0015 + (aDef - 75) * -0.006, TACTICAL_CAP);
    awayDefenseFactor = dataFactor * (1 + tacticalDelta);
  } else {
    awayDefenseFactor = (150 - aDef) / 75; // higher manual DEF -> leakier-goals factor shrinks
  }

  let awayAttackFactor;
  if (awayProfile && awayProfile.away_goals_for != null) {
    const dataFactor = awayProfile.away_goals_for / AWAY_LEAGUE_AVG;
    const tacticalDelta = clampFactor((aAtt - 75) * 0.006 + (aMid - 75) * 0.002, TACTICAL_CAP);
    awayAttackFactor = dataFactor * (1 + tacticalDelta);
  } else {
    awayAttackFactor = aAtt / 75;
  }

  let homeDefenseFactor;
  if (homeProfile && homeProfile.home_goals_against != null) {
    const dataFactor = homeProfile.home_goals_against / HOME_LEAGUE_AVG;
    const tacticalDelta = clampFactor((hMid - 75) * -0.0015 + (hDef - 75) * -0.006, TACTICAL_CAP);
    homeDefenseFactor = dataFactor * (1 + tacticalDelta);
  } else {
    homeDefenseFactor = (150 - hDef) / 75;
  }

  // ── MOMENTUM — real recency-weighted W/D/L when available, else the old
  // manual 1-5 form slider rescaled to the same -1..+1 range it represents.
  const homeMomentum = homeProfile && homeProfile.momentum_index != null
    ? homeProfile.momentum_index
    : (hForm - 3) / 2;
  const awayMomentum = awayProfile && awayProfile.momentum_index != null
    ? awayProfile.momentum_index
    : (aForm - 3) / 2;

  let xGH = HOME_LEAGUE_AVG * homeAttackFactor * awayDefenseFactor * (1 + clampFactor(homeMomentum, 1) * MOMENTUM_CAP);
  let xGA = AWAY_LEAGUE_AVG * awayAttackFactor * homeDefenseFactor * (1 + clampFactor(awayMomentum, 1) * MOMENTUM_CAP);
  xGH = Math.max(0.15, xGH);
  xGA = Math.max(0.15, xGA);

  // ── VOLATILITY -> DISPERSION — feeds the Negative Binomial markets below.
  // Missing data defaults to 0.3 (roughly the league-average volatility_index
  // observed in the aggregated CSV), which keeps r high (near-Poisson) rather
  // than assuming an unknown team is wildly chaotic.
  const homeVolatility = homeProfile && homeProfile.volatility_index != null ? homeProfile.volatility_index : 0.3;
  const awayVolatility = awayProfile && awayProfile.volatility_index != null ? awayProfile.volatility_index : 0.3;
  const rHome = Math.max(2, Math.min(14, 12 - 10 * homeVolatility));
  const rAway = Math.max(2, Math.min(14, 12 - 10 * awayVolatility));

  const homeWeight = Math.max(0.08, xGH / (xGA + 0.5));
  const awayWeight = Math.max(0.08, xGA / (xGH + 0.5));
  // UPGRADE: draw cushion tightened 1.6→1.1 so draws compress faster as the
  // xG gap widens, matching the "draws rarer for sharp favourites" request.
  const drawWeight = Math.max(0.08, 1 / (Math.abs(xGH - xGA) + 1.1));
  const totalWeight = homeWeight + awayWeight + drawWeight;
  let pH = homeWeight / totalWeight;
  let pD = drawWeight / totalWeight;
  let pA = awayWeight / totalWeight;

  // FIX: safety clamp — without this, an extreme mismatch (e.g. 90 vs 50
  // rated teams) could push pH high enough that `1/(pH*margin)` dropped
  // below 1.00, an invalid odds value. Real books cap probability so the
  // shortest price never goes below ~1.01. Clamping here keeps every
  // downstream market mathematically valid no matter how lopsided the input.
  const clamp = (p) => Math.min(0.95, Math.max(0.01, p));
  pH = clamp(pH); pD = clamp(pD); pA = clamp(pA);
  const clampSum = pH + pD + pA;
  pH /= clampSum; pD /= clampSum; pA /= clampSum;

  const margin = M.main_line; // admin-configurable (CHANGE 019); was hardcoded 1.05
  const mainLine = applyMargin(
    [{ key: "home", p: pH }, { key: "draw", p: pD }, { key: "away", p: pA }],
    margin
  );

  // ── BOTH TEAMS TO SCORE 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n──────
  // NEW (CHANGE 003): blended 50/50 with real btts_rate when both teams have
  // profile data — previously this was derived purely from xGH/xGA with no
  // grounding in how often it actually happens for these teams.
  const formulaBtts = Math.min(0.85, Math.max(0.15, (xGH * xGA) / ((xGH + 1) * (xGA + 1)) * 1.4));
  const dataBtts = (homeProfile?.btts_rate != null && awayProfile?.btts_rate != null)
    ? (homeProfile.btts_rate + awayProfile.btts_rate) / 2
    : null;
  const pBttsYes = dataBtts != null
    ? Math.min(0.85, Math.max(0.15, 0.5 * formulaBtts + 0.5 * dataBtts))
    : formulaBtts;
  const bttsFlat = applyMargin(
    [{ key: "yes", p: pBttsYes }, { key: "no", p: 1 - pBttsYes }],
    M.btts
  );
  const btts = { yes: bttsFlat.yes, no: bttsFlat.no };

  // ── TOTAL GOALS OVER/UNDER — multiple lines ─────────────────────────────
  // NEW MARKET: proper Poisson distribution over the combined xG — P(total
  // goals > line) = 1 − P(total ≤ floor(line)), summed across every
  // home/away goal combination that produces each total. Generalized from a
  // single hardcoded 2.5 line into three curated lines (1.5 / 2.5 / 3.5)
  // covering low, mid, and high-scoring expectations.
  function totalGoalsAtLine(line) {
    const maxGoals = Math.floor(line);
    let pUnder = 0;
    for (let total = 0; total <= maxGoals; total++) {
      for (let h = 0; h <= total; h++) {
        pUnder += negBinomPMF(h, xGH, rHome) * negBinomPMF(total - h, xGA, rAway);
      }
    }
    const pOver = 1 - pUnder;
    const flat = applyMargin([{ key: "over", p: pOver }, { key: "under", p: pUnder }], M.total_goals);
    return { line, over: flat.over, under: flat.under };
  }
  // Kept exactly as before for backward compatibility — `totalGoals` is the
  // single 2.5 line object every existing call site already reads.
  const totalGoals = totalGoalsAtLine(2.5);
  // NEW: curated alternate lines, keyed by line value as a string.
  const totalGoalsLines = {
    "1.5": totalGoalsAtLine(1.5),
    "2.5": totalGoals,
    "3.5": totalGoalsAtLine(3.5),
  };

  // ── ASIAN HANDICAP 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n───────────
  // NEW MARKET: uses the full Poisson joint distribution rather than the
  // simplified 3-bucket 1X2 weight formula, since handicap requires
  // evaluating every possible scoreline against a shifted margin (not just
  // home/draw/away buckets). A whole-number handicap (e.g. -1, 0, +2) can
  // produce a genuine push (stake refunded) when the adjusted margin lands
  // exactly on zero — quarter/half lines (-1.5, -0.5) never push, matching
  // real Asian Handicap rules.
  function handicapAtLine(handicapHome) {
    let pHomeCover = 0, pAwayCover = 0, pPush = 0;
    const maxG = 8; // Poisson tail beyond 8 goals/side is negligible
    for (let h = 0; h <= maxG; h++) {
      for (let a = 0; a <= maxG; a++) {
        const p = negBinomPMF(h, xGH, rHome) * negBinomPMF(a, xGA, rAway);
        const adjustedMargin = (h - a) + handicapHome;
        if (adjustedMargin > 0) pHomeCover += p;
        else if (adjustedMargin < 0) pAwayCover += p;
        else pPush += p;
      }
    }
    const fair = [{ key: "home", p: pHomeCover }, { key: "away", p: pAwayCover }];
    if (pPush > 0.001) fair.push({ key: "push", p: pPush });
    const flat = applyMargin(fair, M.handicap);
    return { line: handicapHome, home: flat.home, away: flat.away, push: flat.push || null };
  }
  // Auto-select a roughly balanced "main" line from the xG gap — same idea
  // as the existing auto corner/card lines. Negative = home favoured.
  let mainHandicapLine = -Math.round((xGH - xGA) * 2) / 2;
  mainHandicapLine = Math.max(-3, Math.min(3, mainHandicapLine));
  const handicap = {
    main: handicapAtLine(mainHandicapLine),
    alt1: handicapAtLine(mainHandicapLine - 1), // shifted toward the away side
    alt2: handicapAtLine(mainHandicapLine + 1), // shifted toward the home side
  };

  // ── HALF-TIME / FULL-TIME 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n────
  // NEW MARKET: split match xG into a first-half share (44%, since the first
  // half of football typically sees fewer goals than the second in real
  // data) and a second-half share, compute independent half-outcome
  // probabilities for each, then combine into the 9 HT/FT combos with a
  // "continuation bonus" (a team leading at HT is much more likely to also
  // win at FT) and a "reversal penalty" (trailing at HT then winning outright
  // is rare). This is an approximation of the true joint scoreline
  // distribution, but produces realistic relative ordering between combos,
  // which is what matters for pricing.
  function halfOutcomeProbs(xh, xa) {
    const hw = Math.max(0.05, xh / (xa + 0.6));
    const aw = Math.max(0.05, xa / (xh + 0.6));
    const dw = Math.max(0.05, 1 / (Math.abs(xh - xa) + 0.7));
    const t = hw + aw + dw;
    return { home: hw / t, draw: dw / t, away: aw / t };
  }
  const htShare = 0.44, ftShare = 0.56;
  const ht1 = halfOutcomeProbs(xGH * htShare, xGA * htShare);
  const ht2 = halfOutcomeProbs(xGH * ftShare, xGA * ftShare); // 2nd-half-only outcome
  const htFtCombos = [];
  ["home", "draw", "away"].forEach(h => {
    ["home", "draw", "away"].forEach(f => {
      let weight = ht1[h] * ht2[f];
      if (h === f) weight *= 1.8;             // result carries through both halves
      if ((h === "home" && f === "away") || (h === "away" && f === "home")) weight *= 0.25; // rare full reversal
      htFtCombos.push({ key: `${h}_${f}`, p: weight });
    });
  });
  const htFt = applyMargin(htFtCombos, M.ht_ft); // long-tail market — heavier margin

  // ── CORRECT SCORE 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n────────────
  // FIX: replaced the old heuristic (`5.0 + distance-from-xG * 4.5`, an
  // arbitrary formula with no real probabilistic basis) with an actual
  // Poisson joint distribution over home/away goals — this is the standard
  // method real sportsbooks use to price correct score, and correctly makes
  // the most-likely scorelines (e.g. 1-1, 1-0 for an even match) the
  // shortest-priced outcomes.
  const scoreGrid = ["0-0","1-0","0-1","2-0","0-2","1-1","2-1","1-2","2-2","3-0","0-3","3-1","1-3","3-2","2-3"];
  const scoreFair = scoreGrid.map(s => {
    const [h, a] = s.split("-").map(Number);
    return { key: s, p: negBinomPMF(h, xGH, rHome) * negBinomPMF(a, xGA, rAway) };
  });
  const correctScores = applyMargin(scoreFair, M.correct_score, 2.5, 150); // long-tail market — heavy margin, 2.50 odds floor

  // ── DYNAMIC CORNERS LINE 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────
  // unchanged: not probability-derived, kept as a flat bookmaker-style line
  const cornerBaseline = +Math.max(7.5, (hMid + aMid + hAtt + aAtt) / 40).toFixed(1);
  const corners = { line: cornerBaseline, over: 1.85, under: 1.85 };

  // ── DYNAMIC CARDS LINE 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n────────
  // unchanged: not probability-derived, kept as a flat bookmaker-style line
  const defensiveDeficit = (hAtt - hDef) + (aAtt - aDef);
  const cardLine = defensiveDeficit > 15 ? 4.5 : defensiveDeficit > 5 ? 3.5 : 2.5;
  const cards = { line: cardLine, over: 1.90, under: 1.80 };

  // ── ANYTIME GOALSCORER / ANYTIME ASSIST ──────────────────────────────────
  // NEW MARKET: we only have a flat comma-separated roster (no per-player
  // attack rating), so attacking weight is distributed using the player's
  // position in the list — first-named players are assumed the most advanced
  // / attack-minded (a reasonable proxy since admins naturally list strikers
  // and attacking players first). Weight decays geometrically (0.72^index)
  // so the nominal striker gets meaningfully more goal threat than a player
  // listed 6th or 7th. Each player's expected goals = team xG × their share ×
  // 0.85 (the ~15% remainder covers own goals / unaccounted scorers). Margin
  // is heavy (45%) matching how real anytime-scorer markets are priced.
  function buildScorerMarket(rosterList, teamXG, marginTarget = 1.45, isAssist = false) {
    if (!rosterList || rosterList.length === 0) return {};
    const weights = rosterList.map((_, i) => Math.pow(0.72, i));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    // Assists are slightly more probable than goals overall (more players
    // can register one per goal scored) so we boost the rate slightly and
    // flatten the decay a touch so mid-table players get more assist share.
    const goalShareMultiplier = isAssist ? 1.15 : 1.0;
    const fair = rosterList.map((name, i) => {
      const share = (weights[i] / totalWeight) * goalShareMultiplier;
      const playerXG = Math.min(2.5, teamXG * share * 0.85);
      const p = Math.min(0.92, 1 - Math.exp(-playerXG)); // P(scores/assists >= 1)
      return { key: name, p };
    });
    return applyMargin(fair, marginTarget, 1.05, 60);
  }
  const anytimeScorer = {
    home: buildScorerMarket(roster.home, xGH, M.scorer, false),
    away: buildScorerMarket(roster.away, xGA, M.scorer, false),
  };
  const anytimeAssist = {
    home: buildScorerMarket(roster.home, xGH, M.assist, true),
    away: buildScorerMarket(roster.away, xGA, M.assist, true),
  };

  return { mainLine, btts, corners, cards, correctScores, totalGoals, totalGoalsLines, handicap, htFt, anytimeScorer, anytimeAssist };
}

// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
// AUTH CONTEXT
// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
const AuthCtx  = createContext(null);
const useAuth  = () => useContext(AuthCtx); // eslint-disable-line — kept for future use

// 8387rcPNz8SRX6pYXgdxCZg3VMLFwtdJB3Z9LeX8Ge2n─────────────────────────────────
// AUTH SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode,     setMode]     = useState("login");
  const [form,     setForm]     = useState({ name: "", email: "", password: "", confirm: "" });
  const [showPass, setShowPass] = useState(false);
  const [err,      setErr]      = useState("");
  // NEW: separate from err — used for the "check your email to confirm"
  // case after signup, which isn't a failure, so it shouldn't render in the
  // red error box.
  const [info,     setInfo]     = useState("");
  const [loading,  setLoading]  = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  // WIRED (Session 8, item 12 — the last remaining blocker from the
  // migration tracker) — this used to check email+password against
  // localStorage (getDB().users). Every RPC in this file checks auth.uid()
  // server-side, so a "logged in" user from the old localStorage check was
  // never actually authenticated as far as Supabase was concerned — every
  // RPC call would have failed its own authorization check regardless of
  // how correct the RPC's own param names were.
  // DELIBERATE DESIGN CHOICE: unlike every other RPC call in this file,
  // there is NO localStorage fallback here if Supabase auth fails. Silently
  // falling back to a fake local login would produce a currentUser with no
  // matching real session — every subsequent RPC call would then fail with
  // a confusing "Unauthorized" instead of this screen showing the real
  // auth error up front. Auth failures should be visible, not masked.
  const submit = async () => {
    setErr(""); setInfo(""); setLoading(true);

    if (mode === "login") {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });
      if (error) { setErr(error.message); setLoading(false); return; }

      // Auth succeeded — fetch the matching profiles row for role/balance/
      // username, since currentUser throughout this app expects
      // { uid, email, name, role, balance, createdAt }, not the raw auth
      // user object.
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();
      if (profileErr || !profile) {
        setErr("Signed in, but couldn't load your profile. " + (profileErr?.message || ""));
        setLoading(false);
        return;
      }

      onLogin({
        uid:       profile.id,
        email:     profile.email,
        name:      profile.username,
        role:      profile.role,
        balance:   profile.balance,
        // NEW (CHANGE 017): carried through so NotificationBell can filter
        // muted types from the very first render, not just after the
        // 15s refreshProfile poll catches up.
        notification_prefs: profile.notification_prefs || {},
        // NEW (CHANGE 018): personal stake limit, null if unset.
        max_stake_limit: profile.max_stake_limit,
        createdAt: new Date(profile.created_at).getTime(),
      });
      setLoading(false);

    } else {
      if (!form.name.trim())              { setErr("Enter your name.");           setLoading(false); return; }
      if (form.password !== form.confirm) { setErr("Passwords don't match.");     setLoading(false); return; }
      if (form.password.length < 6)       { setErr("Password too short.");        setLoading(false); return; }

      // NEW: username passed via options.data so the handle_new_user_signup
      // trigger (which reads NEW.raw_user_meta_data->>'username') creates
      // the profiles row with the right name instead of falling back to the
      // email prefix.
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: { data: { username: form.name.trim() } },
      });
      if (error) { setErr(error.message); setLoading(false); return; }

      // If the Supabase project requires email confirmation, signUp
      // succeeds but returns no session yet — nothing to log in with until
      // the user confirms via email. Show that plainly instead of silently
      // failing or pretending login happened.
      if (!data.session) {
        setInfo("Account created! Check your email to confirm, then sign in.");
        setMode("login");
        setLoading(false);
        return;
      }

      // Email confirmation is off for this project — session exists
      // immediately. The trigger already created the profiles row inside
      // the same transaction as the auth.users insert, so it's safe to
      // read it back right away.
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();
      if (profileErr || !profile) {
        setErr("Account created, but couldn't load your profile. " + (profileErr?.message || ""));
        setLoading(false);
        return;
      }

      onLogin({
        uid:       profile.id,
        email:     profile.email,
        name:      profile.username,
        role:      profile.role,
        balance:   profile.balance,
        notification_prefs: profile.notification_prefs || {},
        max_stake_limit: profile.max_stake_limit,
        createdAt: new Date(profile.created_at).getTime(),
      });
      setLoading(false);
    }
  };

  // UPGRADE: allow Enter key to submit the form naturally
  const handleKeyDown = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚽</div>
          <div style={{ fontWeight: 900, fontSize: 26, color: C.accent, letterSpacing: -1 }}>PES BOOKIE</div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Master League & BAL Betting Console</div>
        </div>

        <div style={styles.card}>
          <div style={{ display: "flex", background: C.bg, borderRadius: 8, padding: 4, marginBottom: 24, gap: 4 }}>
            {["login", "register"].map(m => (
              <button key={m} onClick={() => { setMode(m); setErr(""); setInfo(""); }}
                style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer",
                  fontWeight: 700, fontSize: 13,
                  background: mode === m ? C.accent : "transparent",
                  color:      mode === m ? C.bg    : C.muted,
                  transition: "all 0.2s" }}>
                {m === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }} onKeyDown={handleKeyDown}>
            {mode === "register" && (
              <div>
                <label style={styles.label}>Your Name</label>
                <input style={styles.input} placeholder="e.g. Omondi" value={form.name} onChange={set("name")} />
              </div>
            )}
            <div>
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" placeholder="you@email.com" value={form.email} onChange={set("email")} />
            </div>
            <div>
              <label style={styles.label}>Password</label>
              <div style={{ position: "relative" }}>
                <input style={{ ...styles.input, paddingRight: 44 }}
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={set("password")} />
                <button type="button" onClick={() => setShowPass(s => !s)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", fontSize: 16 }}>
                  {showPass ? "🙈" : "👁️"}
                </button>
              </div>
            </div>
            {mode === "register" && (
              <div>
                <label style={styles.label}>Confirm Password</label>
                <input style={styles.input}
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••"
                  value={form.confirm}
                  onChange={set("confirm")} />
              </div>
            )}

            {err && (
              <div style={{ color: C.red, fontSize: 13, background: C.red + "15", borderRadius: 6, padding: "8px 12px" }}>
                {err}
              </div>
            )}

            {/* NEW: distinct from the error box above — not a failure, just
                telling the person to go confirm their email before signing in. */}
            {info && (
              <div style={{ color: C.accent, fontSize: 13, background: C.accent + "15", borderRadius: 6, padding: "8px 12px" }}>
                {info}
              </div>
            )}

            <button style={{ ...styles.btn("primary"), padding: "12px 0", width: "100%" }} onClick={submit} disabled={loading}>
              {loading ? "…" : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </div>
 
          {mode === "login" && (
            <div style={{ marginTop: 16, padding: "12px 14px", background: C.bg, borderRadius: 8, fontSize: 12, color: C.muted }}>
              <strong style={{ color: C.yellow }}>Admin access:</strong> register normally, then set{" "}
              <code style={{ color: C.text }}>role = 'admin'</code> for that account directly in Supabase.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVBAR
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION BELL
// NEW (CHANGE 010): frontend for the notifications system (schema: CHANGE
// 008/009). Realtime-driven, not polled — subscribes to postgres_changes
// on the notifications table filtered to this user's own rows, same
// pattern the rest of the schema already uses for profiles/matches.
// ─────────────────────────────────────────────────────────────────────────────
const NOTIFICATION_ICON = {
  bet_won: "🎉", bet_lost: "📉", bet_voided: "↩️", bet_cashedout: "💰",
  deposit_approved: "✅", deposit_rejected: "❌",
  withdrawal_approved: "✅", withdrawal_rejected: "❌",
  wallet_request_pending: "🔔",
};

function timeAgo(ms) {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function NotificationBell({ user }) {
  const [items, setItems] = useState([]);
  const [open,  setOpen]  = useState(false);
  const dropdownRef = useRef(null);

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.uid)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      setItems(data || []);
    } catch (err) {
      // No localStorage fallback — notifications only ever exist in
      // Supabase, nothing meaningful to fall back to.
      console.warn('[NotificationBell] Supabase unavailable:', err.message);
    }
  }, [user.uid]);

  useEffect(() => { reload(); }, [reload]);

  // Realtime: new notifications appear instantly, and a mark-as-read from
  // another tab/device stays in sync, without any polling interval.
  useEffect(() => {
    const channel = supabase
      .channel(`notifications-${user.uid}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.uid}` },
        (payload) => setItems(prev => [payload.new, ...prev].slice(0, 30)))
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.uid}` },
        (payload) => setItems(prev => prev.map(n => n.id === payload.new.id ? payload.new : n)))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.uid]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // NEW (CHANGE 017): filters out muted types. A muted notification still
  // exists and is still unread in the DB — it's just not shown/counted
  // here, so un-muting later correctly surfaces anything that happened
  // while muted, rather than losing it.
  const visibleItems = items.filter(n => user.notification_prefs?.[n.type] !== false);
  const unreadCount = visibleItems.filter(n => !n.is_read).length;

  const markAsRead = async (id) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n)); // optimistic
    try {
      const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.warn('[NotificationBell] markAsRead failed:', err.message);
    }
  };

  const markAllRead = async () => {
    const unreadIds = visibleItems.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    setItems(prev => prev.map(n => ({ ...n, is_read: true }))); // optimistic
    try {
      const { error } = await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
      if (error) throw error;
    } catch (err) {
      console.warn('[NotificationBell] markAllRead failed:', err.message);
    }
  };

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", cursor: "pointer", position: "relative", padding: 6, fontSize: 17, lineHeight: 1 }}>
        🔔
        {unreadCount > 0 && (
          <span style={{ position: "absolute", top: 0, right: 0, background: C.accent, color: "#fff",
            borderRadius: 999, fontSize: 10, fontWeight: 800, minWidth: 16, height: 16,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
            boxShadow: `0 0 0 2px ${C.surface}` }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 340, maxHeight: 420,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
          boxShadow: C.cardShadowLg, zIndex: 2000, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
            <strong style={{ fontSize: 13 }}>Notifications</strong>
            {unreadCount > 0 && (
              <button onClick={markAllRead}
                style={{ background: "none", border: "none", color: C.accent, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Mark all read
              </button>
            )}
          </div>
          <div style={{ overflowY: "auto" }}>
            {visibleItems.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>No notifications yet.</div>
            ) : (
              visibleItems.map(n => (
                <div key={n.id} onClick={() => !n.is_read && markAsRead(n.id)}
                  style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`,
                    cursor: n.is_read ? "default" : "pointer",
                    background: n.is_read ? "transparent" : C.accent + "0c",
                    display: "flex", gap: 10 }}>
                  <div style={{ fontSize: 16 }}>{NOTIFICATION_ICON[n.type] || "🔔"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.4 }}>{n.message}</div>
                    <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>{timeAgo(new Date(n.created_at).getTime())}</div>
                  </div>
                  {!n.is_read && <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.accent, marginTop: 4, flexShrink: 0 }} />}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Navbar({ user, onLogout, tab, setTab }) {
  const adminTabs  = ["Dashboard", "Matches", "Team Stats", "Users", "Wallets Balance","Settings"];
  const bettorTabs = ["Match Board", "My Bets", "Wallet Dashboard", "Settings"];
  const tabs = user.role === "admin" ? adminTabs : bettorTabs;

  // NEW: mobile nav fix — tabs previously used flexWrap inside a fixed-height
  // (56px) bar, so on a narrow phone screen they wrapped onto extra lines
  // and got clipped/stacked instead of laying out cleanly. Below 640px this
  // switches the tab row to horizontal scroll instead of wrapping — same
  // isMobile breakpoint pattern already used by BetslipBasket.
  const isMobile = useWindowWidth() < 640;

  return (
    <nav style={{ ...styles.nav,
      height:        isMobile ? "auto" : styles.nav.height,
      flexDirection: isMobile ? "column" : "row",
      alignItems:    isMobile ? "stretch" : "center",
      padding:       isMobile ? "10px 16px" : styles.nav.padding,
      gap:           isMobile ? 8 : 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={styles.logo}>⚽ <span>SALEMBOOKIES</span></div>
        {/* On mobile, the bell/badge/logout move up next to the logo so the
            row below is dedicated entirely to the scrollable tab list. */}
        {isMobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <NotificationBell user={user} />
            <span style={styles.badge(user.role === "admin" ? C.yellow : C.accent)}>{user.role}</span>
            <button style={styles.btn("ghost")} onClick={onLogout}>Out</button>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 2,
        flexWrap:  isMobile ? "nowrap" : "wrap",
        overflowX: isMobile ? "auto"   : "visible",
        WebkitOverflowScrolling: "touch" }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ background: tab === t ? C.accent + "18" : "transparent",
              color:  tab === t ? C.accent : C.muted,
              border: "none", borderRadius: 6, padding: "6px 11px",
              fontWeight: 600, fontSize: 13, cursor: "pointer",
              whiteSpace: "nowrap", flexShrink: 0 }}>
            {t}
          </button>
        ))}
      </div>
      {/* NEW (CHANGE 010): notification bell, sits between the tab list
          and the role badge/logout — visible for both roles. Desktop only
          here now; on mobile this same block renders up next to the logo. */}
      {!isMobile && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <NotificationBell user={user} />
          <span style={styles.badge(user.role === "admin" ? C.yellow : C.accent)}>{user.role}</span>
          <button style={styles.btn("ghost")} onClick={onLogout}>Out</button>
        </div>
      )}
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAT CARD
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    // UI POLISH: left accent border strip so each stat card has an at-a-glance
    // color identity matching the value's semantic meaning (green = good,
    // red = liability, purple = risk). Previously all cards looked identical.
    <div style={{ ...styles.card, flex: 1, minWidth: 150, borderLeft: `3px solid ${accent || C.border}`, paddingLeft: 18 }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      {/* UI POLISH: subtle text-shadow on the value so important numbers feel
          prominent rather than just being larger text in a flat card. */}
      <div style={{ fontSize: 24, fontWeight: 800, color: accent || C.text, letterSpacing: -0.5,
        textShadow: accent ? `0 0 20px ${accent}44` : "none" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCH CARD
// FIX: BetslipBasket was reading `match.odds[item.outcome]` expecting a flat
// { home, draw, away } shape. With the engine now returning mainLine instead of
// match, createMatch spreads `mainLine` plus the full tree onto match.odds so
// the flat keys are still accessible via `match.odds.home` etc.
// ─────────────────────────────────────────────────────────────────────────────
function MatchCard({ match, actions, activeSlipKeys, onToggleSlipSelection }) {
  const st = STATUS[match.status] || STATUS.upcoming;

  return (
    <div style={{ ...styles.card, border: `1px solid ${st.color}33`, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={styles.badge(st.color)}>{st.label}</span>
          <span style={styles.badge(C.purple)}>{MODE_LABELS[match.mode] || match.mode}</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>{match.kickoff ? ts(match.kickoff) : "TBD"}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{match.homeTeam}</div>
          <div style={{ fontSize: 11, color: C.muted }}>
            ⭐ {match.homeStats?.att || match.homeRating || "—"} · {match.homeStats?.form || match.homeForm || "—"}/5 form
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          {/* REVERTED: 'completed'→'settled' — new live schema uses open/locked/settled/cancelled */}
          {match.status === "settled" && match.result ? (
            <div style={{ fontWeight: 900, fontSize: 22, color: C.accent }}>
              {match.result.homeGoals} – {match.result.awayGoals}
            </div>
          ) : (
            <div style={{ fontWeight: 700, fontSize: 14, color: C.muted }}>VS</div>
          )}
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{match.awayTeam}</div>
          <div style={{ fontSize: 11, color: C.muted }}>
            ⭐ {match.awayStats?.att || match.awayRating || "—"} · {match.awayStats?.form || match.awayForm || "—"}/5 form
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: actions ? 14 : 0 }}>
        {[
          { label: `1 — ${match.homeTeam}`, key: "home", color: C.accent  },
          { label: "X — Draw",              key: "draw", color: C.yellow  },
          { label: `2 — ${match.awayTeam}`, key: "away", color: C.blue   },
        ].map(({ label, key, color }) => {
          const selectionKey  = `${match.id}-${key}`;
          const isSelected    = activeSlipKeys?.includes(selectionKey);
          const isWinner      = match.result?.outcome === key;
          // REVERTED: 'scheduled'→'open' — new live schema's place_bet checks status = 'open'
          const isSelectable  = onToggleSlipSelection && match.status === "open";

          return (
            <div key={key}
              onClick={() => isSelectable && onToggleSlipSelection(match, key)}
              style={{ background: C.bg, borderRadius: 8, padding: "10px 8px", textAlign: "center",
                cursor: isSelectable ? "pointer" : "default",
                border: isWinner ? `1px solid ${color}` : isSelected ? `2px solid ${color}` : `1px solid ${C.border}`,
                boxShadow: isSelected ? `${color}22 0px 0px 8px` : "none" }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, letterSpacing: 0.5 }}>{label}</div>
              <div style={{ fontWeight: 800, fontSize: 20, color }}>{fmtOdds(match.odds?.[key] || 0)}</div>
            </div>
          );
        })}
      </div>

      {/* REVERTED: 'completed'→'settled' */}
      {match.status === "settled" && match.result && (
        <div style={{ textAlign: "center" }}>
          <span style={styles.badge(
            match.result.outcome === "home" ? C.accent
            : match.result.outcome === "away" ? C.blue
            : C.yellow
          )}>
            {match.result.outcome === "home" ? `${match.homeTeam} Win`
             : match.result.outcome === "away" ? `${match.awayTeam} Win`
             : "Draw"}
          </span>
        </div>
      )}

      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// NEW: per-match exposure breakdown for the admin dashboard. For every
// open/locked match with active bets, shows total staked and the worst-case
// payout per 1X2 outcome — the highest one is the admin's actual liability
// if that result happens. Only grades 1X2 legs (home/draw/away); sub-market
// exposure isn't included here since a bar chart across dozens of outcome
// types wouldn't be readable — the existing flat "Book Exposure Liability"
// stat card still covers total exposure across every market.
// ─────────────────────────────────────────────────────────────────────────────
function ExposureByMatch({ matches, bets }) {
  // REVERTED: 'scheduled'/'live'→'open'/'locked' — new live schema
  const activeMatches = matches.filter(m => m.status === "open" || m.status === "locked");
  if (activeMatches.length === 0) return null;

  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{ margin: "0 0 14px", fontWeight: 700, fontSize: 16 }}>Live Exposure by Match</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {activeMatches.map(m => {
          // Collect every active bet (single or accumulator) that has a 1X2
          // leg on this match.
          const matchBets = bets.filter(b => {
            if (b.status !== "active") return false;
            if (!b.selections && b.matchId === m.id) return true;
            if (b.selections) return b.selections.some(s => s.matchId === m.id && ["home", "draw", "away"].includes(s.outcome));
            return false;
          });
          if (matchBets.length === 0) return null;

          const payoutIf = { home: 0, draw: 0, away: 0 };
          const stakedOn = { home: 0, draw: 0, away: 0 };
          matchBets.forEach(b => {
            const legs = b.selections
              ? b.selections.filter(s => s.matchId === m.id && ["home", "draw", "away"].includes(s.outcome))
              : [{ outcome: b.outcome, odds: b.odds, stake: b.stake }];
            legs.forEach(leg => {
              const outcome = leg.outcome;
              // FIX (vs Phase 5 draft): was `if (!payoutIf[outcome] === undefined) return;`
              // which is always false (boolean negated before the comparison), so the
              // guard never fired. Direct undefined check instead.
              if (payoutIf[outcome] === undefined) return;
              const stake = b.selections ? b.stake : leg.stake;
              const odds  = leg.odds;
              payoutIf[outcome] = +(payoutIf[outcome] + stake * odds).toFixed(2);
              stakedOn[outcome] = +(stakedOn[outcome] + stake).toFixed(2);
            });
          });

          const totalStaked = Object.values(stakedOn).reduce((a, b) => a + b, 0);
          const maxPayout    = Math.max(payoutIf.home, payoutIf.draw, payoutIf.away);
          const outcomes     = [
            { key: "home", label: m.homeTeam, color: C.accent },
            { key: "draw", label: "Draw",     color: C.yellow },
            { key: "away", label: m.awayTeam, color: C.blue   },
          ];

          return (
            <div key={m.id} style={{ ...styles.card, border: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{m.homeTeam} vs {m.awayTeam}</div>
                <div style={{ display: "flex", gap: 10, fontSize: 12, color: C.muted }}>
                  <span>{matchBets.length} bet{matchBets.length !== 1 ? "s" : ""}</span>
                  <span>·</span>
                  <span>Staked: <strong style={{ color: C.text }}>{fmt(totalStaked)}</strong></span>
                  <span>·</span>
                  <span>Max payout: <strong style={{ color: C.red }}>{fmt(maxPayout)}</strong></span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {outcomes.map(({ key, label, color }) => {
                  const payout  = payoutIf[key];
                  const isWorst = payout === maxPayout && maxPayout > 0;
                  const barPct  = maxPayout > 0 ? (payout / maxPayout) * 100 : 0;
                  return (
                    <div key={key}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color, fontWeight: 600 }}>If {label} wins</span>
                        <span style={{ fontWeight: 700, color: isWorst ? C.red : C.text }}>
                          {fmt(payout)}{isWorst ? " ⚠ worst case" : ""}
                        </span>
                      </div>
                      <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${barPct}%`, background: isWorst ? C.red : color, borderRadius: 3, transition: "width 0.4s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdminDashboard({ user, setTab }) {
  // MIGRATION 9e: previously read getDB() directly, inline, during render —
  // synchronous localStorage reads allowed that. Nothing populates that
  // object anymore now that matches/transactions/bets all write to Supabase,
  // so dashboard numbers stayed at zero/stale regardless of real activity.
  // Fetching from Supabase is async, so this needs useState + useEffect —
  // same shape already used elsewhere in this file (e.g. AdminMatches.reload).
  const [bettors, setBettors] = useState([]);
  const [matches, setMatches] = useState([]);
  const [txns,    setTxns]    = useState([]);
  const [bets,    setBets]    = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [
          { data: profileRows, error: profileErr },
          { data: matchRows,   error: matchErr },
          { data: txnRows,     error: txnErr },
          { data: betRows,     error: betErr },
        ] = await Promise.all([
          supabase.from('profiles').select('*').eq('role', 'bettor'),
          supabase.from('matches').select('*').order('created_at', { ascending: false }),
          supabase.from('transactions').select('*'),
          // bet_legs embedded — ExposureByMatch (child component, unchanged)
          // needs per-leg matchId/outcome, same shape BettorMyBets uses.
          supabase.from('bets').select('*, bet_legs(*)'),
        ]);
        if (profileErr) throw profileErr;
        if (matchErr)   throw matchErr;
        if (txnErr)     throw txnErr;
        if (betErr)     throw betErr;

        setBettors((profileRows || []).map(p => ({ uid: p.id, balance: Number(p.balance) })));

        // Same full mapping AdminMatches.reload()/BettorBoard already use —
        // kept identical so the 3 preview MatchCards below render real
        // odds/stats instead of falling back to "—" placeholders.
        setMatches((matchRows || []).map(m => ({
          id:        m.id,
          homeTeam:  m.home_team,
          awayTeam:  m.away_team,
          mode:      m.mode || 'ml',
          kickoff:   m.kickoff ? new Date(m.kickoff).getTime() : null,
          status:    m.status,
          odds:      m.odds || {},
          homeStats: m.home_stats || {},
          awayStats: m.away_stats || {},
          roster:    m.roster || { home: [], away: [] },
          result:    m.home_score !== null ? {
            homeGoals: m.home_score, awayGoals: m.away_score,
            outcome:   m.home_score > m.away_score ? 'home' : m.away_score > m.home_score ? 'away' : 'draw',
          } : null,
          createdAt: new Date(m.created_at).getTime(),
        })));

        setTxns((txnRows || []).map(t => ({
          type:   t.type,
          status: t.status,
          amount: Number(t.amount),
        })));

        setBets((betRows || []).map(b => ({
          status:  b.status === 'pending' ? 'active' : b.status,
          stake:   Number(b.stake),
          odds:    Number(b.total_odds),
          payout:  b.actual_payout != null ? Number(b.actual_payout) : undefined,
          selections: (b.bet_legs || []).map(leg => ({
            matchId: leg.match_id,
            outcome: leg.selection,
            odds:    Number(leg.odds_at_placement),
          })),
        })));
        return;
      } catch (err) {
        console.warn('[AdminDashboard] Supabase unavailable, using localStorage:', err.message);
      }

      // ── LOCALSTORAGE FALLBACK — identical to the original implementation ──
      const db = getDB();
      setBettors(Object.values(db.users).filter(u => u.role === "bettor"));
      setMatches(db.matches || []);
      setTxns(db.transactions || []);
      setBets(db.bets || []);
    };
    // ITEM 15: mount-only before — dashboard stats (exposure, payouts,
    // deposits) stayed stale until a manual reload. 30s here since these
    // are aggregate/overview numbers, not a pending action needing prompt
    // visibility the way AdminWallets' approval queue does.
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  // ── everything below is UNCHANGED from the original implementation ──
  const totalIn   = txns.filter(t => t.type === "deposit"    && t.status === "approved").reduce((a, t) => a + t.amount, 0);
  const totalOut  = txns.filter(t => t.type === "withdrawal" && t.status === "approved").reduce((a, t) => a + t.amount, 0);
  // REVERTED: 'scheduled'→'open'
  const openMatches = matches.filter(m => m.status === "open").length;

  // Exposure = sum of (potential win payout - stake) for all active bets
  const currentExposure = bets
    .filter(b => b.status === "active")
    .reduce((acc, b) => acc + (b.stake * b.odds - b.stake), 0);

  // NEW: total money paid out via winning bets — i.e. payout credited to a
  // bettor's wallet balance when a bet settles as won. This is distinct from
  // "Total Disbursed" above, which only counts approved withdrawal requests
  // (cash that actually left via M-Pesa). A won bet's payout sits in the
  // bettor's wallet until they withdraw it — without this stat there was no
  // visibility anywhere on the dashboard into how much the book has actually
  // paid out in winnings, since "Book Exposure Liability" only counts
  // still-active bets and drops a bet from that total the instant it settles.
  const totalBetPayouts = bets
    .filter(b => b.status === "won")
    .reduce((acc, b) => acc + (b.payout || 0), 0);

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>Overview</h2>
        <p style={{ color: C.muted, margin: "4px 0 0", fontSize: 13 }}>Your book auditing ledger desk</p>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
        <StatCard label="Bettors"               value={bettors.length}          accent={C.accent} />
        <StatCard label="Open Matches"          value={openMatches}             accent={C.win}    sub="accepting wagers" />
        <StatCard label="Book Exposure Liability" value={fmt(currentExposure)}  accent={C.purple} sub="potential risk payout" />
        <StatCard label="Total Realized Deposits" value={fmt(totalIn)}          accent={C.win} />
        <StatCard label="Total Disbursed"         value={fmt(totalOut)}         accent={C.red} sub="withdrawals only" />
        {/* NEW: separate from "Total Disbursed" — this is winnings credited
            to wallets, not cash that left via M-Pesa withdrawal. */}
        <StatCard label="Total Bet Payouts"       value={fmt(totalBetPayouts)}  accent={C.red} sub="won-bet winnings credited" />
      </div>

      {/* NEW: per-match exposure breakdown */}
      <ExposureByMatch matches={matches} bets={bets} />

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontWeight: 700 }}>Active Matches</h3>
          <button style={styles.btn("primary", "sm")} onClick={() => setTab("Matches")}>Manage Matches →</button>
        </div>
        {matches.length === 0 ? (
          <div style={{ ...styles.card, textAlign: "center", color: C.muted, padding: 32 }}>No matches posted yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[...matches].reverse().slice(0, 3).map(m => <MatchCard key={m.id} match={m} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN MATCHES
// ─────────────────────────────────────────────────────────────────────────────
function AdminMatches() {
  const EMPTY = {
    homeTeam: "", awayTeam: "", mode: "ml", kickoff: "",
    homeAtt: 75, homeMid: 75, homeDef: 75, homeForm: 3,
    awayAtt: 75, awayMid: 75, awayDef: 75, awayForm: 3,
    rosterHome: "", rosterAway: "",
    oddsHome: "", oddsDraw: "", oddsAway: "",
  };

  const [matches,  setMatches]  = useState([]);
  const [view,     setView]     = useState("list");
  const [form,     setForm]     = useState(EMPTY);
  const [suggested, setSuggested] = useState(null);
  const [settling, setSettling] = useState(null);
  const [result,   setResult]   = useState({ homeGoals: "", awayGoals: "", corners: "", cards: "" });
  const [msg,      setMsg]      = useState("");
  const [err,      setErr]      = useState("");
  const [filter,   setFilter]   = useState("all");
  // NEW: free-text search query for the admin match list, filters by team
  // name alongside the existing status filter buttons.
  const [searchQuery, setSearchQuery] = useState("");
  // NEW: arm/disarm state for two-step settle confirmation, plus the timer
  // that auto-disarms it if the admin doesn't follow through.
  const [confirmPending, setConfirmPending] = useState(false);
  const confirmTimer = useRef(null);
  // NEW (CHANGE 004): team_profiles fetched once on mount, keyed by
  // normalized team name so calcSuggested/createMatch can look up real
  // aggregated stats for whichever team names the admin has typed/picked.
  // Not tied to the reload() polling cycle since this data only changes
  // when the admin re-runs the CSV aggregation, not on every match action.
  const [teamProfiles, setTeamProfiles] = useState({});
  // NEW (CHANGE 019): admin-configured bookmaker margins, fetched once on
  // mount same as team_profiles. Null if unreachable — suggestOdds's own
  // built-in defaults apply in that case, so a missing/unreadable row
  // never breaks fixture creation.
  const [marginConfig, setMarginConfig] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from('platform_settings').select('odds_margins').eq('id', true).single();
        if (error) throw error;
        setMarginConfig(data?.odds_margins || null);
      } catch (err) {
        console.warn('[AdminMatches] platform_settings unavailable, using suggestOdds defaults:', err.message);
      }
    })();
  }, []);
  // NEW (CHANGE 007): tracks which existing match is being edited (null in
  // create mode). view "edit" reuses the same form/JSX as "create".
  const [editingMatchId, setEditingMatchId] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from('team_profiles').select('*');
        if (error) throw error;
        const map = {};
        (data || []).forEach(p => { map[normalizeTeamName(p.team_name)] = p; });
        setTeamProfiles(map);
      } catch (err) {
        console.warn('[AdminMatches] team_profiles unavailable, engine will use manual ratings only:', err.message);
      }
    })();
  }, []);

  // MIGRATION: reload now tries Supabase first, falls back to localStorage.
  // Maps Supabase snake_case columns → camelCase shape the UI expects so
  // nothing below this function needs to change.
  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // REVERTED (Session 8) — the previous fix targeted an OLD live schema
      // that split odds across 7 flat columns + extra_markets jsonb. The new
      // live "CORRECTED & COMPLETE" schema restores kickoff/mode/home_stats/
      // away_stats/roster as real columns and stores all odds in one `odds`
      // jsonb blob — matching what this mapping originally assumed. Back to
      // reading them directly.
      const mapped = (data || []).map(m => ({
        id:        m.id,
        homeTeam:  m.home_team,
        awayTeam:  m.away_team,
        mode:      m.mode       || 'ml',
        kickoff:   m.kickoff    ? new Date(m.kickoff).getTime() : null,
        status:    m.status,
        odds:      m.odds       || {},
        homeStats: m.home_stats || {},
        awayStats: m.away_stats || {},
        roster:    m.roster     || { home: [], away: [] },
        result:    m.home_score !== null ? {
          homeGoals:  m.home_score,
          awayGoals:  m.away_score,
          outcome:    m.home_score > m.away_score ? 'home'
                    : m.away_score > m.home_score ? 'away' : 'draw',
        } : null,
        createdAt: new Date(m.created_at).getTime(),
      }));

      setMatches(mapped);

      // Keep localStorage in sync so fallback stays fresh
      const db = getDB();
      db.matches = mapped;
      saveDB(db);

    } catch (err) {
      // Supabase failed — fall back to localStorage silently
      console.warn('[AdminMatches] Supabase unavailable, using localStorage:', err.message);
      setMatches(getDB().matches || []);
    }
  }, []);
  useEffect(() => { reload(); }, [view, reload]);

  // NEW: clear the auto-reset timer if the component unmounts mid-arm,
  // so it doesn't fire setState on an unmounted component.
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const calcSuggested = () => {
    if (!form.homeTeam.trim() || !form.awayTeam.trim()) return setErr("Provide team identities first.");
    setErr("");
    // NEW (CHANGE 004): resolve each team's aggregated profile, if any.
    // A team with no CSV history yet simply gets null — suggestOdds falls
    // back to manual att/mid/def for that side only, nothing breaks.
    const homeProfile = teamProfiles[normalizeTeamName(form.homeTeam)] || null;
    const awayProfile = teamProfiles[normalizeTeamName(form.awayTeam)] || null;
    const lines = suggestOdds(
      { att: form.homeAtt, mid: form.homeMid, def: form.homeDef, form: form.homeForm },
      { att: form.awayAtt, mid: form.awayMid, def: form.awayDef, form: form.awayForm },
      {
        home: form.rosterHome.split(",").map(p => p.trim()).filter(Boolean),
        away: form.rosterAway.split(",").map(p => p.trim()).filter(Boolean),
      },
      homeProfile,
      awayProfile,
      marginConfig
    );
    setSuggested(lines);
    // Store as strings — React controlled inputs require string values to display correctly
    setForm(f => ({ ...f, oddsHome: String(lines.mainLine.home), oddsDraw: String(lines.mainLine.draw), oddsAway: String(lines.mainLine.away) }));
  };

  // NEW (CHANGE 007): extracted from createMatch so updateMatch (fixture
  // editing, added below) can build an identical odds blob without
  // duplicating this flattening logic. Pure function, component-scoped
  // (defined here so both createMatch and updateMatch close over it) —
  // same output as the inline version it replaces.
  function buildOddsBlob(oddsHome, oddsDraw, oddsAway, engine) {
  return {
    home: +oddsHome, draw: +oddsDraw, away: +oddsAway,
    btts_yes: engine.btts.yes, btts_no: engine.btts.no,
    corners_over: engine.corners.over, corners_under: engine.corners.under,
    cards_over: engine.cards.over, cards_under: engine.cards.under,
    ...Object.fromEntries(Object.entries(engine.correctScores).map(([k,v]) => [`score_${k.replace("-","_")}`,v])),
    total_over: engine.totalGoals.over, total_under: engine.totalGoals.under,
    ...Object.fromEntries(Object.entries(engine.totalGoalsLines).flatMap(([l,v]) => [
      [`total_${l.replace(".","_")}_over`, v.over], [`total_${l.replace(".","_")}_under`, v.under]
    ])),
    ...Object.fromEntries([["main",engine.handicap.main],["alt1",engine.handicap.alt1],["alt2",engine.handicap.alt2]]
      .flatMap(([slot,v]) => { const e = [[`handicap_${slot}_home`,v.home],[`handicap_${slot}_away`,v.away]]; if(v.push) e.push([`handicap_${slot}_push`,v.push]); return e; })),
    _totalGoalsLines: engine.totalGoalsLines,
    _handicapLines: { main: engine.handicap.main.line, alt1: engine.handicap.alt1.line, alt2: engine.handicap.alt2.line },
    ...Object.fromEntries(Object.entries(engine.htFt).map(([k,v]) => [`htft_${k}`,v])),
    ...Object.fromEntries(Object.entries(engine.anytimeScorer.home).map(([name,o]) => [`scorer_home_${name}`,o])),
    ...Object.fromEntries(Object.entries(engine.anytimeScorer.away).map(([name,o]) => [`scorer_away_${name}`,o])),
    ...Object.fromEntries(Object.entries(engine.anytimeAssist.home).map(([name,o]) => [`assist_home_${name}`,o])),
    ...Object.fromEntries(Object.entries(engine.anytimeAssist.away).map(([name,o]) => [`assist_away_${name}`,o])),
    _cornerLine: engine.corners.line, _cardLine: engine.cards.line, _totalLine: engine.totalGoals.line,
    correctScores: engine.correctScores, htFt: engine.htFt,
    anytimeScorer: engine.anytimeScorer, anytimeAssist: engine.anytimeAssist,
  };
}

  const createMatch = async () => {
    setErr("");
    if (!form.homeTeam.trim() || !form.awayTeam.trim()) return setErr("Enter both team names.");
    if (!form.oddsHome || !form.oddsDraw || !form.oddsAway)  return setErr("Calculate or set match odds first.");

    const rosterHome = form.rosterHome.split(",").map(p => p.trim()).filter(Boolean);
    const rosterAway = form.rosterAway.split(",").map(p => p.trim()).filter(Boolean);
    // NEW (CHANGE 004): same profile lookup as calcSuggested — kept
    // separate rather than reusing suggested's cached engine output,
    // since the admin may have edited homeAtt/awayForm etc. after last
    // clicking "Compute" and createMatch should always price off the
    // current form state, not a stale preview.
    const homeProfile = teamProfiles[normalizeTeamName(form.homeTeam)] || null;
    const awayProfile = teamProfiles[normalizeTeamName(form.awayTeam)] || null;
    const engine = suggestOdds(
      { att: form.homeAtt, mid: form.homeMid, def: form.homeDef, form: form.homeForm },
      { att: form.awayAtt, mid: form.awayMid, def: form.awayDef, form: form.awayForm },
      { home: rosterHome, away: rosterAway },
      homeProfile,
      awayProfile,
      marginConfig
    );

    // CHANGE 007: now calls the extracted helper instead of building inline.
    const oddsBlob = buildOddsBlob(form.oddsHome, form.oddsDraw, form.oddsAway, engine);

    // REVERTED (Session 8) — the previous fix targeted an OLD live schema
    // with 7 flat odds_* columns + extra_markets jsonb + scheduled/live/
    // completed status values. The new live "CORRECTED & COMPLETE" schema
    // restores the original shape this insert always assumed: kickoff,
    // mode, home_stats, away_stats, roster as real columns, one `odds`
    // jsonb blob holding the full oddsBlob, and status values open/locked/
    // settled/cancelled. Back to the original insert.
    try {
      const { data, error } = await supabase.from('matches').insert([{
        home_team:  form.homeTeam.trim(),
        away_team:  form.awayTeam.trim(),
        mode:       form.mode,
        kickoff:    form.kickoff ? new Date(form.kickoff).toISOString() : null,
        home_stats: { att:+form.homeAtt, mid:+form.homeMid, def:+form.homeDef, form:+form.homeForm },
        away_stats: { att:+form.awayAtt, mid:+form.awayMid, def:+form.awayDef, form:+form.awayForm },
        roster:     { home: rosterHome, away: rosterAway },
        odds:       oddsBlob,
        status:     'open',
      }]).select().single();

      if (error) throw error;
      // Supabase succeeded — reload will pull fresh data including the new match
    } catch (err) {
      // Supabase failed — fall back to localStorage silently
      console.warn('[createMatch] Supabase unavailable, writing to localStorage:', err.message);
      const db = getDB();
      const id  = "m_" + Date.now();
      db.matches = [...(db.matches || []), {
        id, homeTeam: form.homeTeam.trim(), awayTeam: form.awayTeam.trim(),
        mode: form.mode, kickoff: form.kickoff ? new Date(form.kickoff).getTime() : null,
        homeStats: { att:+form.homeAtt, mid:+form.homeMid, def:+form.homeDef, form:+form.homeForm },
        awayStats: { att:+form.awayAtt, mid:+form.awayMid, def:+form.awayDef, form:+form.awayForm },
        roster: { home: rosterHome, away: rosterAway },
        odds: oddsBlob, status: 'open', createdAt: Date.now(), result: null, // REVERTED: back to 'open'
      }];
      saveDB(db);
    }

    await reload();
    setForm(EMPTY); setSuggested(null); setView("list");
    setMsg("Match posted with extended markets successfully!");
    setTimeout(() => setMsg(""), 3000);
  };

  // NEW (CHANGE 007): pre-fills the create-fixture form with an existing
  // match's data and switches to "edit" mode. Team names intentionally
  // carried over as-is (not cleared) — the edit view disables those two
  // fields, since changing a fixture's teams after it's posted (and
  // possibly already has bets on it) would be misleading, not a real edit.
  const openEdit = (match) => {
    setForm({
      homeTeam: match.homeTeam, awayTeam: match.awayTeam, mode: match.mode || "ml",
      kickoff: toDatetimeLocalValue(match.kickoff),
      homeAtt: match.homeStats?.att ?? 75, homeMid: match.homeStats?.mid ?? 75,
      homeDef: match.homeStats?.def ?? 75, homeForm: match.homeStats?.form ?? 3,
      awayAtt: match.awayStats?.att ?? 75, awayMid: match.awayStats?.mid ?? 75,
      awayDef: match.awayStats?.def ?? 75, awayForm: match.awayStats?.form ?? 3,
      rosterHome: (match.roster?.home || []).join(", "),
      rosterAway: (match.roster?.away || []).join(", "),
      oddsHome: String(match.odds?.home ?? ""), oddsDraw: String(match.odds?.draw ?? ""), oddsAway: String(match.odds?.away ?? ""),
    });
    setSuggested(null);
    setEditingMatchId(match.id);
    setErr("");
    setView("edit");
  };

  // NEW (CHANGE 007): recomputes the full odds blob from current form state
  // (same suggestOdds + team_profiles path as createMatch) and UPDATEs the
  // existing matches row. Confirmed with user: safe to allow any time
  // before settle/cancel, since bets already placed keep their locked-in
  // odds_at_placement per leg regardless of what the match's live odds
  // change to afterward — nothing here touches bets or bet_legs.
  const updateMatch = async () => {
    setErr("");
    if (!form.oddsHome || !form.oddsDraw || !form.oddsAway) return setErr("Calculate or set match odds first.");
    if (!editingMatchId) return setErr("No fixture selected for editing.");

    const rosterHome = form.rosterHome.split(",").map(p => p.trim()).filter(Boolean);
    const rosterAway = form.rosterAway.split(",").map(p => p.trim()).filter(Boolean);
    const homeProfile = teamProfiles[normalizeTeamName(form.homeTeam)] || null;
    const awayProfile = teamProfiles[normalizeTeamName(form.awayTeam)] || null;
    const engine = suggestOdds(
      { att: form.homeAtt, mid: form.homeMid, def: form.homeDef, form: form.homeForm },
      { att: form.awayAtt, mid: form.awayMid, def: form.awayDef, form: form.awayForm },
      { home: rosterHome, away: rosterAway },
      homeProfile,
      awayProfile,
      marginConfig
    );
    const oddsBlob = buildOddsBlob(form.oddsHome, form.oddsDraw, form.oddsAway, engine);

    const updatePayload = {
      mode:       form.mode,
      kickoff:    form.kickoff ? new Date(form.kickoff).toISOString() : null,
      home_stats: { att:+form.homeAtt, mid:+form.homeMid, def:+form.homeDef, form:+form.homeForm },
      away_stats: { att:+form.awayAtt, mid:+form.awayMid, def:+form.awayDef, form:+form.awayForm },
      roster:     { home: rosterHome, away: rosterAway },
      odds:       oddsBlob,
    };

    try {
      const { error } = await supabase.from('matches').update(updatePayload).eq('id', editingMatchId);
      if (error) throw error;
    } catch (err) {
      // Supabase failed — fall back to localStorage silently, same pattern
      // every other write path in this file uses.
      console.warn('[updateMatch] Supabase unavailable, writing to localStorage:', err.message);
      const db = getDB();
      db.matches = (db.matches || []).map(m => m.id === editingMatchId ? {
        ...m,
        mode: updatePayload.mode,
        kickoff: form.kickoff ? new Date(form.kickoff).getTime() : null,
        homeStats: updatePayload.home_stats,
        awayStats: updatePayload.away_stats,
        roster: updatePayload.roster,
        odds: updatePayload.odds,
      } : m);
      saveDB(db);
    }

    await reload();
    setForm(EMPTY); setSuggested(null); setEditingMatchId(null); setView("list");
    setMsg("Fixture odds updated — existing bets keep their original locked-in odds.");
    setTimeout(() => setMsg(""), 4000);
  };

  // REVERTED (Session 8) — new live schema's settle_match_and_payouts takes
  // 10 params (p_match_id, p_home_score, p_away_score, p_status, p_ht_home,
  // p_ht_away, p_corners, p_cards, p_scorers, p_assisters) — the last 6 have
  // DEFAULT values in the function signature itself, so passing explicit
  // null/0/empty-array here is optional but kept for clarity/consistency
  // with confirmSettle's call below. 'cancelled' is still a valid p_status.
  const changeStatus = async (matchId, newStatus) => {
    if (newStatus === "cancelled") {
      try {
        const { data, error } = await supabase.rpc('settle_match_and_payouts', {
          p_match_id:   matchId,
          p_home_score: null,
          p_away_score: null,
          p_status:     'cancelled',
          p_ht_home:    null,
          p_ht_away:    null,
          p_corners:    0,
          p_cards:      0,
          p_scorers:    [],
          p_assisters:  [],
        });
        if (error) throw error;
        if (data?.success !== false) { await reload(); return; }
        console.warn('[changeStatus] cancellation RPC returned failure:', data?.message);
      } catch (err) {
        console.warn('[changeStatus] Supabase unavailable, falling back to localStorage refund logic:', err.message);
      }
    } else {
      try {
        const { error } = await supabase.from('matches').update({ status: newStatus }).eq('id', matchId);
        if (error) throw error;
        await reload(); return;
      } catch (err) {
        console.warn('[changeStatus] Supabase unavailable, status only updated in localStorage:', err.message);
      }
    }

    // ── LOCALSTORAGE FALLBACK — identical to the original implementation ──
    const db = getDB();
    db.matches = db.matches.map(m => {
      if (m.id !== matchId) return m;
      // Void all active bets and refund stakes on cancellation
      if (newStatus === "cancelled") {
        db.bets = (db.bets || []).map(b => {
          if (b.status !== "active") return b;

          // --- Legacy single-selection bet shape ---
          if (!b.selections && b.matchId === matchId) {
            const u = db.users[b.userId];
            if (u) u.balance = +(u.balance + b.stake).toFixed(2);
            return { ...b, status: "voided", payout: b.stake };
          }

          // --- Accumulator bet shape (every bet placed via the current betslip) ---
          if (b.selections) {
            const touchesThisMatch = b.selections.some(s => s.matchId === matchId);
            if (!touchesThisMatch) return b;

            // A cancelled leg voids the WHOLE accumulator — a punter never
            // agreed to a slip missing one of its legs — and the full
            // original stake is refunded, not just that leg's share.
            const u = db.users[b.userId];
            if (u) u.balance = +(u.balance + b.stake).toFixed(2);

            const updatedSelections = b.selections.map(s =>
              s.matchId === matchId ? { ...s, result: "void" } : s
            );
            return { ...b, selections: updatedSelections, status: "voided", payout: b.stake };
          }

          return b;
        });
      }
      return { ...m, status: newStatus };
    });
    saveDB(db);
    await reload();
  };

  const openSettle = (match) => {
    setSettling(match);
    // NEW: added optional scorers/assists fields (comma-separated names) so
    // the anytime scorer/assist markets can be graded. HT score fields added
    // so HT/FT can be graded from the actual half-time result instead of an
    // approximation.
    setResult({ homeGoals: "", awayGoals: "", corners: "", cards: "", htHomeGoals: "", htAwayGoals: "", scorers: "", assisters: "" });
    // NEW: always start a fresh settlement screen unarmed.
    setConfirmPending(false);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setView("settle");
  };

  // NEW (CHANGE 013): calls admin_regrade_match (CHANGE 012) directly from
  // the match list — corrective tool for bets mis-graded by the CHANGE 011
  // settlement bug. No two-step confirm like Settle needs: this RPC is
  // idempotent (safe to call on an already-correct match, does nothing)
  // and can only ever flip a wrongly-'lost' leg to 'won'/'push', never the
  // reverse, so there's no real downside to a single click.
  const [regrading, setRegrading] = useState(null); // matchId currently in flight, disables its button
  const regradeMatch = async (matchId) => {
    setRegrading(matchId);
    setErr("");
    try {
      const { data, error } = await supabase.rpc('admin_regrade_match', { p_match_id: matchId });
      if (error) throw error;
      if (!data?.success) {
        setErr(data?.message || "Regrade failed.");
      } else if (data.legs_fixed === 0) {
        setMsg("No corrections needed — this match was already graded correctly.");
      } else {
        setMsg(`Regrade complete: ${data.legs_fixed} leg(s) corrected, ${data.bets_flipped} bet(s) updated, ${data.payouts_issued} payout(s) issued.`);
      }
      setTimeout(() => setMsg(""), 5000);
    } catch (err) {
      setErr("Could not reach the regrade function: " + err.message);
    }
    setRegrading(null);
  };

  // NEW: first click on the settle button calls this — arms the confirm
  // state and starts an 8-second auto-reset. The actual confirmSettle()
  // payout logic only runs on the second click while armed.
  const armSettle = () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmPending(true);
    confirmTimer.current = setTimeout(() => setConfirmPending(false), 8000);
  };

  const confirmSettle = async () => {
    // NEW: reset arm state immediately so the UI is clean even on early return
    setConfirmPending(false);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);

    if (result.homeGoals === "" || result.awayGoals === "") return setErr("Enter the final score.");
    setErr("");

    const hG = parseInt(result.homeGoals);
    const aG = parseInt(result.awayGoals);
    const totalCorners = parseInt(result.corners || 0);
    const totalCards   = parseInt(result.cards   || 0);
    const htH = result.htHomeGoals !== "" ? parseInt(result.htHomeGoals) : null;
    const htA = result.htAwayGoals !== "" ? parseInt(result.htAwayGoals) : null;
    const scorerNames = (result.scorers   || "").split(",").map(s => s.trim()).filter(Boolean);
    const assistNames = (result.assisters || "").split(",").map(s => s.trim()).filter(Boolean);

    // REVERTED (Session 8) — the previous fix targeted an OLD live schema
    // whose settle_match_and_payouts only took 4 params and graded 3
    // markets. The new live "CORRECTED & COMPLETE" schema restores the full
    // 10-param signature AND actually grades every market this frontend
    // builds (1X2, BTTS, TOTAL_GOALS, HANDICAP with push, CORNERS, CARDS,
    // HT_FT, CORRECT_SCORE, SCORER, ASSIST — confirmed from the deployed
    // function's own CASE statement). This RESOLVES the old "Grading
    // coverage gap" finding — sub-market bets will actually settle now
    // instead of sitting 'pending' forever. p_status is 'settled' again
    // (not 'completed').
    try {
      const { data, error } = await supabase.rpc('settle_match_and_payouts', {
        p_match_id:   settling.id,
        p_home_score: hG,
        p_away_score: aG,
        p_status:     'settled',
        p_ht_home:    htH,
        p_ht_away:    htA,
        p_corners:    totalCorners,
        p_cards:      totalCards,
        p_scorers:    scorerNames,
        p_assisters:  assistNames,
      });

      if (error) throw error;
      if (!data?.success) {
        setErr(data?.message || "Settlement failed.");
        return;
      }

      await reload(); setView("list"); setSettling(null);
      setMsg(`Match settled — ${data.payouts_processed} payout(s), ${data.refunds_issued} refund(s).`);
      setTimeout(() => setMsg(""), 4000);
      return;

    } catch (err) {
      // Supabase unavailable — fall back to the original full client-side
      // grading logic so settlement doesn't break entirely mid-migration.
      console.warn('[confirmSettle] Supabase unavailable, using localStorage:', err.message);
    }

    // ── LOCALSTORAGE FALLBACK — identical to the original implementation ──
    const db = getDB();

    // Derive all winning outcome keys from the final match statistics
    const winningOutcomes = [];

    // 1X2
    if (hG > aG)      winningOutcomes.push("home");
    else if (hG < aG) winningOutcomes.push("away");
    else              winningOutcomes.push("draw");

    // BTTS
    if (hG > 0 && aG > 0) winningOutcomes.push("btts_yes");
    else                   winningOutcomes.push("btts_no");

    // Corners — use stored line; fallback 8.5
    const cornerLine = settling.odds?._cornerLine || 8.5;
    winningOutcomes.push(totalCorners > cornerLine ? "corners_over" : "corners_under");

    // Cards — use stored line; fallback 3.5
    const cardLine = settling.odds?._cardLine || 3.5;
    winningOutcomes.push(totalCards > cardLine ? "cards_over" : "cards_under");

    // Correct score — stored as "score_2_1" to match BettorBoard's outcomeKey format
    winningOutcomes.push(`score_${hG}_${aG}`);

    // Total Goals O/U 2.5
    const totalLine = settling.odds?._totalLine || 2.5;
    const totalGoalsScored = hG + aG;
    winningOutcomes.push(totalGoalsScored > totalLine ? "total_over" : "total_under");

    // Total Goals alternate lines (1.5 / 2.5 / 3.5)
    const pushedOutcomes = []; // collects any handicap push keys for refund handling below
    ["1.5", "2.5", "3.5"].forEach(lineStr => {
      const lineKey = lineStr.replace(".", "_");
      const lineVal = settling.odds?._totalGoalsLines?.[lineStr]?.line ?? Number(lineStr);
      winningOutcomes.push(totalGoalsScored > lineVal ? `total_${lineKey}_over` : `total_${lineKey}_under`);
    });

    // Asian Handicap — main line plus two alternates
    const margin = hG - aG;
    ["main", "alt1", "alt2"].forEach(slot => {
      const lineVal = settling.odds?._handicapLines?.[slot];
      if (lineVal === undefined) return; // match predates this feature
      const adjusted = margin + lineVal;
      if (adjusted > 0) winningOutcomes.push(`handicap_${slot}_home`);
      else if (adjusted < 0) winningOutcomes.push(`handicap_${slot}_away`);
      else pushedOutcomes.push(`handicap_${slot}_push`); // tracked separately for refund, not a "win"
    });

    // HT/FT
    const htOutcome = htH === null || htA === null
      ? (hG > aG ? "home" : aG > hG ? "away" : "draw") // approximation when HT score wasn't recorded
      : (htH > htA ? "home" : htA > htH ? "away" : "draw");
    const ftOutcome = hG > aG ? "home" : aG > hG ? "away" : "draw";
    winningOutcomes.push(`htft_${htOutcome}_${ftOutcome}`);

    // Anytime Scorer / Assist — validated against the match's roster
    const allRoster = [...(settling.roster?.home || []), ...(settling.roster?.away || [])];
    scorerNames.forEach(name => {
      if (!allRoster.includes(name)) {
        console.warn(`[Settlement] Scorer "${name}" not found in roster — skipping.`);
        return;
      }
      winningOutcomes.push(`scorer_home_${name}`);
      winningOutcomes.push(`scorer_away_${name}`);
    });
    assistNames.forEach(name => {
      if (!allRoster.includes(name)) {
        console.warn(`[Settlement] Assist "${name}" not found in roster — skipping.`);
        return;
      }
      winningOutcomes.push(`assist_home_${name}`);
      winningOutcomes.push(`assist_away_${name}`);
    });

    // Settle the match record
    db.matches = db.matches.map(m =>
      m.id === settling.id
        ? { ...m, status: "settled", result: { homeGoals: hG, awayGoals: aG, corners: totalCorners, cards: totalCards, outcome: hG > aG ? "home" : aG > hG ? "away" : "draw" } } // REVERTED: 'completed'→'settled'
        : m
    );

    db.bets = (db.bets || []).map(b => {
      if (b.status !== "active") return b;

      // --- Single-selection legacy format ---
      if (!b.selections && b.matchId === settling.id) {
        if (pushedOutcomes.includes(b.outcome)) {
          const u = db.users[b.userId];
          if (u) u.balance = +(u.balance + b.stake).toFixed(2);
          return { ...b, status: "voided", payout: b.stake };
        }
        const isWin = winningOutcomes.includes(b.outcome);
        const payout = isWin ? b.stake * b.odds : 0;
        if (isWin) {
          const u = db.users[b.userId];
          if (u) u.balance = +(u.balance + payout).toFixed(2);
        }
        return { ...b, status: isWin ? "won" : "lost", payout };
      }

      // --- Multi-selection accumulator format ---
      if (b.selections) {
        const touchesThisMatch = b.selections.some(s => s.matchId === settling.id);
        if (!touchesThisMatch) return b;
        if (b.status === "lost") return b;

        const updatedSelections = b.selections.map(s => {
          if (s.matchId !== settling.id) return s;
          if (pushedOutcomes.includes(s.outcome)) return { ...s, result: "push" };
          return { ...s, result: winningOutcomes.includes(s.outcome) ? "won" : "lost" };
        });

        const anyLost    = updatedSelections.some(s => s.result === "lost");
        const allSettled = updatedSelections.every(s => s.result !== undefined);
        const allWon      = allSettled && updatedSelections.every(s => s.result === "won" || s.result === "push");

        if (anyLost) return { ...b, selections: updatedSelections, status: "lost", payout: 0 };
        if (allWon)  {
          const payout = b.stake * b.odds;
          const u = db.users[b.userId];
          if (u) u.balance = +(u.balance + payout).toFixed(2);
          return { ...b, selections: updatedSelections, status: "won", payout };
        }
        return { ...b, selections: updatedSelections };
      }

      return b;
    });

    saveDB(db); await reload(); setView("list"); setSettling(null);
    setMsg("Match and all markets settled!");
    setTimeout(() => setMsg(""), 4000);
  };

  // UPGRADE: search now combines with the existing status filter (AND, not
  // OR) — e.g. searching "arsenal" while the "open" filter pill is active
  // only shows open Arsenal fixtures, not every Arsenal fixture regardless
  // of status.
  // REVERTED: the FILTER_TO_DB_STATUS translation map from the old-schema
  // session is gone — the new live schema's matches.status values
  // (open/locked/settled/cancelled) match the filter pill labels directly
  // again, so a straight comparison works.
  const q = searchQuery.trim().toLowerCase();
  const filtered = matches.filter(m => {
    const matchesStatus = filter === "all" || m.status === filter;
    const matchesSearch = !q || m.homeTeam.toLowerCase().includes(q) || m.awayTeam.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  // ── VIEW: CREATE / EDIT MATCH ────────────────────────────────────────────
  // CHANGE 007: "edit" reuses this exact view — isEditing branches header
  // text, disables the two team-name fields (identity shouldn't change on
  // an existing fixture), and swaps the submit handler at the bottom.
  if (view === "create" || view === "edit") {
  const isEditing = view === "edit";
  return (
    <div style={styles.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button style={styles.btn("ghost", "sm")} onClick={() => { setView("list"); setEditingMatchId(null); setForm(EMPTY); setSuggested(null); }}>← Back to Console</button>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>{isEditing ? "Edit Fixture Odds" : "Configure Upcoming Fixture"}</h2>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 20 }}>
        {/* LEFT: tactical params & rosters */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={styles.card}>
            <h3 style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 16 }}>General Details</h3>
            {/* NEW (CHANGE 004): shared datalist sourced from team_profiles —
                gives autocomplete for known teams while still allowing free
                text for a team with no CSV history yet. */}
            <datalist id="team-names-list">
              {Object.values(teamProfiles).map(p => <option key={p.team_name} value={p.team_name} />)}
            </datalist>
            {/* Team names get their own full-width rows so the text is never clipped */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={styles.label}>Home Team</label>
                <input style={{ ...styles.input, opacity: isEditing ? 0.6 : 1 }} disabled={isEditing}
                  list="team-names-list" placeholder="e.g. Real Madrid" value={form.homeTeam} onChange={set("homeTeam")} />
                {/* NEW (CHANGE 004): tells the admin, before they even hit
                    Compute, whether this side will be data-backed or fall
                    back to manual ratings only. */}
                {form.homeTeam.trim() && (
                  teamProfiles[normalizeTeamName(form.homeTeam)]
                    ? <div style={{ fontSize: 11, color: C.win, marginTop: 4 }}>✓ Data-backed — GW{teamProfiles[normalizeTeamName(form.homeTeam)].last_gw_updated} history found</div>
                    : <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>⚠ No history — manual ratings only</div>
                )}
              </div>
              <div>
                <label style={styles.label}>Away Team</label>
                <input style={{ ...styles.input, opacity: isEditing ? 0.6 : 1 }} disabled={isEditing}
                  list="team-names-list" placeholder="e.g. Barcelona" value={form.awayTeam} onChange={set("awayTeam")} />
                {form.awayTeam.trim() && (
                  teamProfiles[normalizeTeamName(form.awayTeam)]
                    ? <div style={{ fontSize: 11, color: C.win, marginTop: 4 }}>✓ Data-backed — GW{teamProfiles[normalizeTeamName(form.awayTeam)].last_gw_updated} history found</div>
                    : <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>⚠ No history — manual ratings only</div>
                )}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={styles.label}>Game Mode</label>
              <div style={{ display: "flex", gap: 8 }}>
                {["ml", "bal"].map(m => (
                  <button key={m} onClick={() => setForm(f => ({ ...f, mode: m }))}
                    style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", cursor: "pointer",
                      fontWeight: 700, fontSize: 13,
                      background: form.mode === m ? C.purple : C.bg, color: form.mode === m ? C.bg : C.muted }}>
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>
            {/* UPGRADE: Mode selector was missing from the original create form —
                only a plain text input for mode existed. Added toggle buttons. */}
            <div>
              <label style={styles.label}>Estimated Kickoff</label>
              <input style={styles.input} type="datetime-local" value={form.kickoff} onChange={set("kickoff")} />
            </div>
          </div>

          <div style={styles.card}>
            <h3 style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 16 }}>Tactical Team Parameters</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { side: "Home", prefix: "home", team: form.homeTeam || "Home Team" },
                { side: "Away", prefix: "away", team: form.awayTeam || "Away Team" },
              ].map(({ side, prefix, team }) => {
                // NEW (CHANGE 016): whether this side currently resolves to
                // a team_profiles row — if so, momentum_index overrides the
                // manual Form field entirely (see suggestOdds), so the
                // field does nothing for this side right now.
                const isDataBacked = !!teamProfiles[normalizeTeamName(form[`${prefix}Team`])];
                return (
                <div key={side} style={{ background: C.bg, borderRadius: 8, padding: 14, border: `1px solid ${C.card}` }}>
                  <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12, color: side === "Home" ? C.accent : C.blue }}>
                    {team} ({side})
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                    {[
                      { key: `${prefix}Att`,  label: "⚔️ ATT" },
                      { key: `${prefix}Mid`,  label: "🛡️ MID" },
                      { key: `${prefix}Def`,  label: "🛡️ DEF" },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <label style={{ ...styles.label, fontSize: 11 }}>{label}</label>
                        <input style={{ ...styles.input, padding: "6px" }}
                          type="number" min="1" max={99}
                          value={form[key]} onChange={set(key)} />
                      </div>
                    ))}
                    {/* NEW (CHANGE 016): disabled + dimmed + relabeled when
                        data-backed, with a title tooltip explaining why. */}
                    <div>
                      <label style={{ ...styles.label, fontSize: 11, color: isDataBacked ? C.muted : undefined }}>
                        📈 FORM{isDataBacked ? " (unused)" : ""}
                      </label>
                      <input style={{ ...styles.input, padding: "6px", opacity: isDataBacked ? 0.45 : 1 }}
                        type="number" min="1" max="5" disabled={isDataBacked}
                        value={form[`${prefix}Form`]} onChange={set(`${prefix}Form`)}
                        title={isDataBacked ? "This team has real match history — momentum is data-driven, this manual field is ignored." : ""} />
                    </div>
                  </div>
                  <div>
                    <label style={{ ...styles.label, fontSize: 11, color: C.muted }}>📋 Roster (comma-separated)</label>
                    <textarea
                      style={{ ...styles.input, fontFamily: "inherit", fontSize: 12, minHeight: 55, resize: "none", padding: 8 }}
                      placeholder="Player A, Player B, Player C…"
                      value={form[`roster${side}`]}
                      onChange={set(`roster${side}`)} />
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: odds matrix & submit */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={styles.card}>
            <h3 style={{ margin: "0 0 14px", fontWeight: 700, fontSize: 16 }}>Odds Matrix Generation</h3>
            <button type="button"
              style={{ ...styles.btn("yellow"), width: "100%", padding: "12px 0", marginBottom: 16, fontSize: 13, fontWeight: 800 }}
              onClick={calcSuggested}>
              📊 Compute Extended Tactical Lines
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
              {[
                { label: `1 — ${form.homeTeam || "Home"} Win`, key: "oddsHome", color: C.accent },
                { label: "X — Draw",                           key: "oddsDraw", color: C.yellow },
                { label: `2 — ${form.awayTeam || "Away"} Win`, key: "oddsAway", color: C.blue  },
              ].map(({ label, key, color }) => (
                <div key={key}>
                  <label style={{ ...styles.label, color, fontWeight: 600 }}>{label}</label>
                  <input style={{ ...styles.input, fontWeight: 700, fontSize: 16, color }}
                    type="number" step="0.01" min="1.01" value={form[key]} onChange={set(key)} />
                </div>
              ))}
            </div>

            {suggested && (
              <div style={{ background: C.bg, borderRadius: 8, padding: 12, border: `1px solid ${C.card}`, fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: C.win }}>✓ Advanced Markets Generated</div>
                <div style={{ color: C.muted, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  <div>GG: {suggested.btts?.yes} / NG: {suggested.btts?.no}</div>
                  <div>Card Line: {suggested.cards?.line}</div>
                  <div>Corner Line: {suggested.corners?.line}</div>
                  <div>Correct Scores: {suggested.correctScores ? Object.keys(suggested.correctScores).length : 0}</div>
                  {/* NEW: surfaces the newly-added markets in the preview */}
                  <div>Total Goals Lines: {suggested.totalGoalsLines ? Object.keys(suggested.totalGoalsLines).join(", ") : "—"}</div>
                  <div>Handicap (main): {suggested.handicap?.main?.line >= 0 ? "+" : ""}{suggested.handicap?.main?.line} ({suggested.handicap?.main?.home}/{suggested.handicap?.main?.away})</div>
                  <div>HT/FT Combos: {suggested.htFt ? Object.keys(suggested.htFt).length : 0}</div>
                  <div>Home Scorers: {suggested.anytimeScorer?.home ? Object.keys(suggested.anytimeScorer.home).length : 0}</div>
                  <div>Away Scorers: {suggested.anytimeScorer?.away ? Object.keys(suggested.anytimeScorer.away).length : 0}</div>
                </div>
              </div>
            )}
          </div>

          {err && (
            <div style={{ color: C.red, background: C.red + "15", borderRadius: 6, padding: "10px 14px", fontSize: 13 }}>
              {err}
            </div>
          )}

          <button style={{ ...styles.btn("primary"), padding: "14px 0", width: "100%", fontWeight: 800 }} onClick={isEditing ? updateMatch : createMatch}>
            {isEditing ? "💾 Save Updated Odds" : "🚀 Post Fixture with Extended Markets"}
          </button>
        </div>
      </div>
    </div>
  );
  }

  // ── VIEW: SETTLE ───────────────────────────────────────────────────────
  if (view === "settle") {
    // NEW: count active bets touching this match so the confirmation step
    // can show the admin exactly how many bets are about to be paid out —
    // a last-second sanity check before committing real money.
    const activeBetCount = (getDB().bets || []).filter(b => {
      if (b.status !== "active") return false;
      if (!b.selections && b.matchId === settling?.id) return true;
      if (b.selections) return b.selections.some(s => s.matchId === settling?.id);
      return false;
    }).length;

    return (
    <div style={styles.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button style={styles.btn("ghost", "sm")} onClick={() => { setView("list"); setSettling(null); setConfirmPending(false); }}>← Cancel</button>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>Match Settlement Desk</h2>
      </div>

      <div style={{ ...styles.card, maxWidth: 500, margin: "0 auto" }}>
        <h3 style={{ margin: "0 0 4px", fontWeight: 700 }}>{settling?.homeTeam} vs {settling?.awayTeam}</h3>
        <p style={{ margin: "0 0 20px", fontSize: 12, color: C.muted }}>
          Enter final stats to auto-grade all sub-markets and distribute payouts.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={styles.label}>⚽ Full-Time Scoreline</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center" }}>
              <input style={{ ...styles.input, fontSize: 18, fontWeight: 700, textAlign: "center" }}
                type="number" min="0" placeholder="Home"
                value={result.homeGoals} onChange={e => setResult(r => ({ ...r, homeGoals: e.target.value }))} />
              <span style={{ fontWeight: 700, color: C.muted }}>—</span>
              <input style={{ ...styles.input, fontSize: 18, fontWeight: 700, textAlign: "center" }}
                type="number" min="0" placeholder="Away"
                value={result.awayGoals} onChange={e => setResult(r => ({ ...r, awayGoals: e.target.value }))} />
            </div>
          </div>

          {/* NEW: half-time score, optional. If left blank, confirmSettle
              approximates HT result using the full-time scoreline instead. */}
          <div>
            <label style={styles.label}>🕐 Half-Time Scoreline (optional — improves HT/FT accuracy)</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center" }}>
              <input style={{ ...styles.input, fontSize: 16, fontWeight: 600, textAlign: "center" }}
                type="number" min="0" placeholder="Home"
                value={result.htHomeGoals} onChange={e => setResult(r => ({ ...r, htHomeGoals: e.target.value }))} />
              <span style={{ fontWeight: 700, color: C.muted }}>—</span>
              <input style={{ ...styles.input, fontSize: 16, fontWeight: 600, textAlign: "center" }}
                type="number" min="0" placeholder="Away"
                value={result.htAwayGoals} onChange={e => setResult(r => ({ ...r, htAwayGoals: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={styles.label}>📐 Total Corners</label>
              <input style={styles.input} type="number" min="0" placeholder="e.g. 9"
                value={result.corners} onChange={e => setResult(r => ({ ...r, corners: e.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>🟨 Total Cards</label>
              <input style={styles.input} type="number" min="0" placeholder="e.g. 4"
                value={result.cards} onChange={e => setResult(r => ({ ...r, cards: e.target.value }))} />
            </div>
          </div>

          {/* NEW: scorer/assist names, comma-separated, must match roster
              names exactly so they line up with the scorer_/assist_ odds keys. */}
          <div>
            <label style={styles.label}>⚽ Goalscorers (comma-separated, exact roster names)</label>
            <input style={styles.input} placeholder="e.g. Haaland, Cherki"
              value={result.scorers} onChange={e => setResult(r => ({ ...r, scorers: e.target.value }))} />
          </div>
          <div>
            <label style={styles.label}>🅰️ Assists (comma-separated, exact roster names)</label>
            <input style={styles.input} placeholder="e.g. Rodri"
              value={result.assisters} onChange={e => setResult(r => ({ ...r, assisters: e.target.value }))} />
          </div>

          {err && (
            <div style={{ color: C.red, background: C.red + "15", borderRadius: 6, padding: "10px 14px", fontSize: 12 }}>
              {err}
            </div>
          )}

          {/* NEW: two-step confirmation. Step 1 (unarmed) shows the normal
              primary button. Clicking it arms the confirmation instead of
              paying out immediately. Step 2 (armed) shows a red confirm
              button plus the live bet count, and a Cancel to back out.
              Auto-disarms after 8 seconds so an accidental first click is
              harmless and self-corrects without leaving the UI stuck. */}
          {!confirmPending ? (
            <button style={{ ...styles.btn("primary"), width: "100%", padding: "12px 0", fontWeight: 800, marginTop: 8 }}
              onClick={armSettle}>
              🔒 Finalise & Distribute Payouts
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ background: C.red + "15", border: `1px solid ${C.red}44`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.red, textAlign: "center" }}>
                ⚠️ This will pay out <strong>{activeBetCount}</strong> active bet{activeBetCount !== 1 ? "s" : ""} immediately. Click below to confirm.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...styles.btn("danger"), flex: 1, padding: "12px 0", fontWeight: 800 }} onClick={confirmSettle}>
                  ✅ Yes — Confirm Payout
                </button>
                <button style={{ ...styles.btn("ghost"), flex: 1, padding: "12px 0" }}
                  onClick={() => { setConfirmPending(false); clearTimeout(confirmTimer.current); }}>
                  Cancel
                </button>
              </div>
              <div style={{ fontSize: 11, color: C.muted, textAlign: "center" }}>Auto-cancels in 8 seconds if you don't confirm.</div>
            </div>
          )}
        </div>
      </div>
    </div>
    );
  }

  // ── VIEW: LIST ─────────────────────────────────────────────────────────
  return (
    <div style={styles.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>Match Admin Control</h2>
          <p style={{ color: C.muted, margin: "4px 0 0", fontSize: 13 }}>Manage fixtures, adjust parameters, and settle live markets.</p>
        </div>
        <button style={styles.btn("primary")} onClick={() => setView("create")}>➕ Create New Fixture</button>
      </div>

      {/* NEW: team name search, combines with the status filter pills below */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ position: "relative", maxWidth: 360 }}>
          <input
            style={{ ...styles.input, paddingLeft: 36 }}
            placeholder="Search by team name…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 14, pointerEvents: "none" }}>🔍</span>
          {searchQuery && (
            <button onClick={() => setSearchQuery("")}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13 }}>
              ✕
            </button>
          )}
        </div>
        {q && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
            {filtered.length} match{filtered.length !== 1 ? "es" : ""} found
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {["all", "open", "upcoming", "locked", "settled", "cancelled"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: "6px 14px", borderRadius: 20, border: "none", fontWeight: 700, fontSize: 12,
              cursor: "pointer", textTransform: "capitalize",
              background: filter === f ? C.accent : C.card,
              color:      filter === f ? C.bg     : C.muted }}>
            {f}
          </button>
        ))}
      </div>

      {msg && (
        <div style={{ color: C.win, background: C.win + "15", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
          {msg}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.length === 0 ? (
          <div style={{ ...styles.card, textAlign: "center", color: C.muted, padding: 30 }}>No fixtures match this filter.</div>
        ) : (
          filtered.map(m => (
            <div key={m.id} style={{ ...styles.card, display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{m.homeTeam} vs {m.awayTeam}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                  Mode: {(MODE_LABELS[m.mode] || m.mode).toUpperCase()} | Status:{" "}
                  {/* Label via STATUS map — harmless either way since STATUS keys are
                      back to open/locked/settled and match m.status directly again. */}
                  <span style={{ color: STATUS[m.status]?.color || C.muted }}>{(STATUS[m.status]?.label || m.status).toUpperCase()}</span>
                  {m.kickoff && ` | ${ts(m.kickoff)}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {/* REVERTED (whole button block): scheduled→open, live→locked, completed→settled — new live schema */}
                {m.status === "upcoming" && <button style={styles.btn("primary", "sm")} onClick={() => changeStatus(m.id, "open")}>Open Bets</button>}
                {m.status === "open"     && <button style={styles.btn("yellow", "sm")}  onClick={() => changeStatus(m.id, "locked")}>🔒 Lock</button>}
                {m.status === "locked"   && <button style={styles.btn("primary", "sm")} onClick={() => openSettle(m)}>📊 Settle</button>}
                {/* UPGRADE: admin can also settle directly from "open" status without
                    locking first — useful when a match is played immediately */}
                {m.status === "open"     && <button style={styles.btn("yellow", "sm")}  onClick={() => openSettle(m)}>📊 Settle</button>}
                {/* NEW (CHANGE 013): corrective regrade for settled matches
                    only — checks this match's already-graded legs against
                    the CHANGE 011-fixed logic and corrects anything the
                    old bug mis-graded. Disabled while its own call is in
                    flight so a double-click can't fire two requests. */}
                {m.status === "settled" && (
                  <button style={styles.btn("ghost", "sm")} disabled={regrading === m.id} onClick={() => regradeMatch(m.id)}>
                    {regrading === m.id ? "⏳ Regrading…" : "🔄 Regrade"}
                  </button>
                )}
                {/* NEW (CHANGE 007): edit an existing fixture's odds — any
                    status except settled/cancelled, same guard as Cancel
                    below. Existing bets are unaffected (odds_at_placement
                    is locked per-leg at bet time). */}
                {!["settled","cancelled"].includes(m.status) && (
                  <button style={styles.btn("ghost", "sm")} onClick={() => openEdit(m)}>✏️ Edit Odds</button>
                )}
                {!["settled","cancelled"].includes(m.status) && (
                  <button style={styles.btn("danger", "sm")} onClick={() => changeStatus(m.id, "cancelled")}>🚫 Cancel</button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN USERS
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// ADMIN TEAM STATS
// NEW (CHANGE 006): read-only view over team_profiles — closes the
// visibility gap raised after the odds-engine redesign: the admin had no
// way to see what the engine currently believes about a team (win rates,
// momentum, volatility) before trusting it in a live fixture. No editing
// in this pass — just visibility. Sortable by clicking a column header.
// ─────────────────────────────────────────────────────────────────────────────
// NEW (CHANGE 015): quote-aware CSV parser — handles embedded commas
// inside quoted fields (H_FORM/A_FORM columns look like "D,W,W,L,W"),
// which a naive split(",") would incorrectly break apart even though
// those two columns aren't actually used by the aggregation below.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = "";
        if (row.some(f => f !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); if (row.some(f => f !== "")) rows.push(row); }
  return rows;
}

const MOMENTUM_WEIGHTS = [5, 4, 3, 2, 1];
const RESULT_SCORE = { W: 1, D: 0, L: -1 };

// NEW (CHANGE 015): recency-weighted W/D/L score over the last 5 games.
// BUG FIX vs the original Python script (aggregate_team_profiles.py):
// that version paired the oldest-to-newest last5 array directly against
// MOMENTUM_WEIGHTS (heaviest-first) via zip(), which actually gave the
// OLDEST of the last 5 games the heaviest weight — backwards from the
// intended "most recent weighted heaviest". Verified empirically (a team
// with an old loss + 4 recent wins scored only +0.33 under the old logic
// instead of the ~+0.87 it should). Fixed here by iterating from the
// most-recent game outward.
function computeMomentum(resultsFullHistory) {
  const last5 = resultsFullHistory.slice(-5); // oldest -> newest
  if (last5.length === 0) return 0;
  let weightedSum = 0, weightSum = 0;
  for (let i = 0; i < last5.length; i++) {
    const result = last5[last5.length - 1 - i]; // i=0 -> most recent
    const w = MOMENTUM_WEIGHTS[i] ?? 1;
    weightedSum += RESULT_SCORE[result] * w;
    weightSum += w;
  }
  return +(weightedSum / weightSum).toFixed(4);
}

// Streakiness (how often consecutive results differ) blended with chaos
// rate — same formula as the Python script, that part was correct.
function computeVolatility(resultsFullHistory, chaosRate) {
  let switchRate = 0;
  if (resultsFullHistory.length >= 2) {
    let switches = 0;
    for (let i = 0; i < resultsFullHistory.length - 1; i++) {
      if (resultsFullHistory[i] !== resultsFullHistory[i + 1]) switches++;
    }
    switchRate = switches / (resultsFullHistory.length - 1);
  }
  return +(0.6 * switchRate + 0.4 * chaosRate).toFixed(4);
}

// NEW (CHANGE 015): full client-side port of aggregate_team_profiles.py.
// Takes raw CSV text, returns { [normalized_team_name]: profileRow }.
// Chaos/BTTS are derived directly from FT_HOME/FT_AWAY on every row
// (never trusted from a source CHAOS column, same reasoning as the
// original script) — H_FORM/A_FORM columns are parsed but unused, since
// full history is reconstructed match-by-match instead.
function aggregateTeamProfilesFromCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) throw new Error("CSV appears empty or has no data rows.");

  const header = rows[0].map(h => h.trim().toUpperCase());
  const col = (name) => header.indexOf(name);
  const iGW = col("GAME_WEEK"), iHome = col("HOME_TEAM"), iAway = col("AWAY_TEAM"),
        iFTH = col("FT_HOME"), iFTA = col("FT_AWAY");
  if ([iGW, iHome, iAway, iFTH, iFTA].some(i => i === -1)) {
    throw new Error("CSV must have GAME_WEEK, HOME_TEAM, AWAY_TEAM, FT_HOME, FT_AWAY columns.");
  }

  const matchesByTeam = {};
  rows.slice(1).forEach(r => {
    const gwRaw = (r[iGW] || "").trim();
    if (!gwRaw) return; // blank separator row between game weeks
    const gw = parseInt(gwRaw, 10);
    const home = normalizeTeamName(r[iHome]);
    const away = normalizeTeamName(r[iAway]);
    const fh = parseInt(r[iFTH], 10), fa = parseInt(r[iFTA], 10);
    if (!Number.isFinite(gw) || !home || !away || !Number.isFinite(fh) || !Number.isFinite(fa)) return;

    const bothScored1 = fh >= 1 && fa >= 1;
    const bothScored2 = fh >= 2 && fa >= 2;
    const homeResult = fh > fa ? "W" : fh < fa ? "L" : "D";
    const awayResult = fa > fh ? "W" : fa < fh ? "L" : "D";

    (matchesByTeam[home] ??= []).push({ gw, venue: "home", gf: fh, ga: fa, result: homeResult, btts: bothScored1, chaos: bothScored2 });
    (matchesByTeam[away] ??= []).push({ gw, venue: "away", gf: fa, ga: fh, result: awayResult, btts: bothScored1, chaos: bothScored2 });
  });

  if (Object.keys(matchesByTeam).length === 0) {
    throw new Error("No valid match rows found — check the CSV's column values.");
  }

  const profiles = {};
  Object.entries(matchesByTeam).forEach(([team, matches]) => {
    matches.sort((a, b) => a.gw - b.gw);
    const homeM = matches.filter(m => m.venue === "home");
    const awayM = matches.filter(m => m.venue === "away");
    const avg  = (vals) => vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3) : null;
    const rate = (vals) => vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4) : null;

    const fullResults = matches.map(m => m.result);
    const chaosRate = rate(matches.map(m => (m.chaos ? 1 : 0)));
    const bttsRate  = rate(matches.map(m => (m.btts ? 1 : 0)));

    profiles[team] = {
      team_name: team,
      home_goals_for:     avg(homeM.map(m => m.gf)),
      home_goals_against: avg(homeM.map(m => m.ga)),
      away_goals_for:     avg(awayM.map(m => m.gf)),
      away_goals_against: avg(awayM.map(m => m.ga)),
      home_win_rate: rate(homeM.map(m => (m.result === "W" ? 1 : 0))),
      away_win_rate: rate(awayM.map(m => (m.result === "W" ? 1 : 0))),
      btts_rate: bttsRate,
      clean_sheet_rate: rate(matches.map(m => (m.ga === 0 ? 1 : 0))),
      chaos_rate: chaosRate,
      recent_form: fullResults.slice(-5).join(","),
      momentum_index: computeMomentum(fullResults),
      volatility_index: computeVolatility(fullResults, chaosRate || 0),
      last_gw_updated: Math.max(...matches.map(m => m.gw)),
      updated_at: new Date().toISOString(),
    };
  });

  return profiles;
}

function AdminTeamStats() {
  const [teams,    setTeams]    = useState([]);
  const [sortKey,  setSortKey]  = useState("team_name");
  const [sortDir,  setSortDir]  = useState("asc");
  const [loading,  setLoading]  = useState(true);
  const [err,      setErr]      = useState("");

  // NEW (CHANGE 015): CSV import — parsed-but-not-yet-uploaded preview,
  // a separate error channel from the main table's `err` (so a bad CSV
  // doesn't blank out the existing team data on screen), and an
  // in-flight flag for the actual upload call.
  const [csvPreview,   setCsvPreview]   = useState(null); // { [team]: profileRow } | null
  const [csvError,     setCsvError]     = useState("");
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvMsg,       setCsvMsg]       = useState("");
  const fileInputRef = useRef(null);

  const handleCsvFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(""); setCsvMsg(""); setCsvPreview(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const profiles = aggregateTeamProfilesFromCSV(evt.target.result);
        setCsvPreview(profiles);
      } catch (err) {
        setCsvError(err.message);
      }
    };
    reader.onerror = () => setCsvError("Could not read the file.");
    reader.readAsText(file);
  };

  // NEW (CHANGE 015): confirmed with user — replace mode. A single bulk
  // upsert (one round-trip, not 20 individual inserts) overwrites every
  // team_profiles row named in the CSV; teams NOT in this CSV are left
  // untouched (this only ever adds/overwrites, never deletes a team).
  const confirmCsvUpload = async () => {
    if (!csvPreview) return;
    setCsvUploading(true); setCsvError(""); setCsvMsg("");
    try {
      const rows = Object.values(csvPreview);
      const { error } = await supabase.from('team_profiles').upsert(rows, { onConflict: 'team_name' });
      if (error) throw error;
      setCsvMsg(`Uploaded ${rows.length} team profile(s) successfully.`);
      setCsvPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await reload();
    } catch (err) {
      setCsvError("Upload failed: " + err.message);
    }
    setCsvUploading(false);
  };

  const cancelCsvPreview = () => {
    setCsvPreview(null); setCsvError(""); setCsvMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const reload = async () => {
    setErr("");
    try {
      const { data, error } = await supabase.from('team_profiles').select('*');
      if (error) throw error;
      setTeams(data || []);
    } catch (e) {
      // No localStorage fallback here — team_profiles only ever exists in
      // Supabase (populated by the CSV aggregation script), there's nothing
      // meaningful to fall back to.
      console.warn('[AdminTeamStats] Supabase unavailable:', e.message);
      setErr("Could not load team data. " + e.message);
    }
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);

  const COLUMNS = [
    { key: "team_name",         label: "Team",         fmt: v => v },
    { key: "home_win_rate",     label: "Home Win%",    fmt: v => v != null ? `${(v * 100).toFixed(0)}%` : "—" },
    { key: "away_win_rate",     label: "Away Win%",    fmt: v => v != null ? `${(v * 100).toFixed(0)}%` : "—" },
    { key: "btts_rate",         label: "BTTS%",        fmt: v => v != null ? `${(v * 100).toFixed(0)}%` : "—" },
    { key: "chaos_rate",        label: "Chaos%",       fmt: v => v != null ? `${(v * 100).toFixed(0)}%` : "—" },
    { key: "clean_sheet_rate",  label: "Clean Sheet%", fmt: v => v != null ? `${(v * 100).toFixed(0)}%` : "—" },
    { key: "momentum_index",    label: "Momentum",     fmt: v => v != null ? v.toFixed(2) : "—" },
    { key: "volatility_index",  label: "Volatility",   fmt: v => v != null ? v.toFixed(2) : "—" },
    { key: "recent_form",       label: "Last 5",        fmt: v => v || "—" },
    { key: "last_gw_updated",   label: "Last GW",       fmt: v => v != null ? `GW${v}` : "—" },
  ];

  const handleSort = (key) => {
    if (key === sortKey) { setSortDir(d => d === "asc" ? "desc" : "asc"); return; }
    setSortKey(key); setSortDir("asc");
  };

  const sorted = [...teams].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Color-codes momentum/volatility cells so the admin can eyeball extremes
  // (very hot/cold streaks, very chaotic teams) without reading every number.
  const cellColor = (key, val) => {
    if (val == null) return C.muted;
    if (key === "momentum_index") return val > 0.3 ? C.win : val < -0.3 ? C.red : C.text;
    if (key === "volatility_index") return val > 0.5 ? C.yellow : C.text;
    return C.text;
  };

  return (
    <div style={styles.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>Team Stats</h2>
          <p style={{ color: C.muted, margin: "4px 0 0", fontSize: 13 }}>
            What the odds engine currently knows about each team, aggregated from match history. Click a column to sort.
          </p>
        </div>
        <button style={styles.btn("ghost", "sm")} onClick={reload}>↻ Refresh</button>
      </div>

      {err && <div style={{ color: C.red, background: C.red + "15", borderRadius: 6, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>{err}</div>}

      {/* NEW (CHANGE 015): CSV import — replaces the old "paste to Claude,
          get a SQL file back" workflow with a self-serve uploader. Parses
          entirely client-side (aggregateTeamProfilesFromCSV), shows a
          preview before anything touches the database. */}
      <div style={{ ...styles.card, marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 15 }}>Import Match History CSV</h3>
        <p style={{ color: C.muted, fontSize: 12, margin: "0 0 14px" }}>
          Needs columns GAME_WEEK, HOME_TEAM, AWAY_TEAM, FT_HOME, FT_AWAY. Uploading replaces the
          existing profile for any team named in the file — teams not mentioned are left untouched.
        </p>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsvFileSelect}
          style={{ fontSize: 13, color: C.muted }} />

        {csvError && <div style={{ color: C.red, background: C.red + "15", borderRadius: 6, padding: "10px 14px", fontSize: 13, marginTop: 12 }}>{csvError}</div>}
        {csvMsg   && <div style={{ color: C.win, background: C.win + "15", borderRadius: 6, padding: "10px 14px", fontSize: 13, marginTop: 12 }}>{csvMsg}</div>}

        {csvPreview && (() => {
          const previewRows = Object.values(csvPreview);
          return (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                Preview — {previewRows.length} team{previewRows.length !== 1 ? "s" : ""} found. Nothing uploaded yet.
              </div>
              <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {COLUMNS.map(c => (
                        <th key={c.key} style={{ textAlign: "left", padding: "8px 12px", color: C.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap" }}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map(row => (
                      <tr key={row.team_name} style={{ borderBottom: `1px solid ${C.border}` }}>
                        {COLUMNS.map(c => (
                          <td key={c.key} style={{ padding: "8px 12px", whiteSpace: "nowrap", fontWeight: c.key === "team_name" ? 700 : 500 }}>
                            {c.fmt(row[c.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...styles.btn("primary", "sm"), opacity: csvUploading ? 0.6 : 1 }}
                  onClick={confirmCsvUpload} disabled={csvUploading}>
                  {csvUploading ? "⏳ Uploading…" : `✓ Confirm & Upload ${previewRows.length} Team(s)`}
                </button>
                <button style={styles.btn("ghost", "sm")} onClick={cancelCsvPreview} disabled={csvUploading}>Cancel</button>
              </div>
            </div>
          );
        })()}
      </div>

      {loading ? (
        <div style={{ ...styles.card, textAlign: "center", color: C.muted, padding: 32 }}>Loading…</div>
      ) : teams.length === 0 ? (
        <div style={{ ...styles.card, textAlign: "center", color: C.muted, padding: 32 }}>
          No team data yet — run the CSV aggregation script and its seed SQL against this project.
        </div>
      ) : (
        <div style={{ ...styles.card, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {COLUMNS.map(col => (
                  <th key={col.key} onClick={() => handleSort(col.key)}
                    style={{ textAlign: "left", padding: "12px 14px", cursor: "pointer", userSelect: "none",
                      color: sortKey === col.key ? C.accent : C.muted, fontSize: 11, fontWeight: 700,
                      letterSpacing: 0.5, textTransform: "uppercase", whiteSpace: "nowrap" }}>
                    {col.label}{sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => (
                <tr key={t.id || t.team_name} style={{ borderBottom: i < sorted.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  {COLUMNS.map(col => (
                    <td key={col.key} style={{ padding: "10px 14px", whiteSpace: "nowrap",
                      fontWeight: col.key === "team_name" ? 700 : 500,
                      color: cellColor(col.key, t[col.key]) }}>
                      {col.fmt(t[col.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminUsers() {
  const [users, setUsers] = useState([]);
  // MIGRATION 9d: previously only read getDB().users, which nothing writes
  // to anymore now that signup goes through real Supabase auth — real
  // registered bettors never appeared in this list.
  const reload = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'bettor')
        .order('created_at', { ascending: false });
      if (error) throw error;

      setUsers((data || []).map(p => ({
        uid:       p.id,
        name:      p.username,
        email:     p.email,
        balance:   Number(p.balance),
        createdAt: new Date(p.created_at).getTime(),
      })));
      return;
    } catch (err) {
      console.warn('[AdminUsers.reload] Supabase unavailable, using localStorage:', err.message);
    }

    // ── LOCALSTORAGE FALLBACK — identical to the original implementation ──
    setUsers(Object.values(getDB().users).filter(u => u.role === "bettor"));
  };
  // ITEM 15: mount-only before. 30s here (not 15s) since a new registration
  // showing up isn't as time-sensitive as a pending money request.
  useEffect(() => {
    reload();
    const interval = setInterval(reload, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>Bettors Ecosystem</h2>
        <p style={{ color: C.muted, margin: "4px 0 0", fontSize: 13 }}>{users.length} registered bettor{users.length !== 1 ? "s" : ""}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {users.length === 0 ? (
          <div style={{ ...styles.card, color: C.muted, textAlign: "center" }}>No registered bettors.</div>
        ) : (
          users.map(u => (
            <div key={u.uid} style={{ ...styles.card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{u.name}</div>
                <div style={{ fontSize: 12, color: C.muted }}>
                  {u.email} · Registered {new Date(u.createdAt).toLocaleDateString("en-KE")}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", marginBottom: 2 }}>Liquid Wallet</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.accent }}>{fmt(u.balance)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN WALLETS
// FIX: original had a typo — "decline" action string was "decline" but the
// handler branched on `action === "approve"` / else, meaning decline worked by
// coincidence.  Made explicit for clarity and safety.
// ─────────────────────────────────────────────────────────────────────────────
function AdminWallets() {
  const [users, setUsers] = useState({});
  const [txns,  setTxns]  = useState([]);
  const [err,   setErr]   = useState("");
  const [msg,   setMsg]   = useState("");

  // MIGRATION 9c: previously only read getDB().transactions/.users, which
  // nothing writes to anymore now that handleProcessTransaction below calls
  // the real process_wallet_request RPC and BettorWallet submits requests
  // straight to Supabase. This was the most urgent of the five reload gaps —
  // real pending deposit/withdrawal requests were invisible to the admin.
  const reload = async () => {
    try {
      const [
        { data: profileRows, error: profileErr },
        { data: txnRows,     error: txnErr },
      ] = await Promise.all([
        supabase.from('profiles').select('*'),
        supabase.from('transactions').select('*').order('created_at', { ascending: false }),
      ]);
      if (profileErr) throw profileErr;
      if (txnErr)     throw txnErr;

      // Keyed by id so existing `users[t.userId]` lookups below keep working unchanged.
      const userMap = (profileRows || []).reduce((acc, p) => {
        acc[p.id] = { uid: p.id, name: p.username, email: p.email, role: p.role, balance: Number(p.balance) };
        return acc;
      }, {});

      // NUMERIC/DECIMAL columns (amount) come back as strings over the
      // PostgREST API — wrapped in Number() here so downstream math/display
      // (fmt(t.amount), etc.) works correctly.
      const mappedTxns = (txnRows || []).map(t => ({
        id:        t.id,
        userId:    t.user_id,
        type:      t.type,
        amount:    Number(t.amount),
        mpesa:     t.mpesa_code,
        note:      t.note,
        status:    t.status,
        createdAt: new Date(t.created_at).getTime(),
      }));

      setUsers(userMap);
      setTxns(mappedTxns);
      return;
    } catch (err) {
      console.warn('[AdminWallets.reload] Supabase unavailable, using localStorage:', err.message);
    }

    // ── LOCALSTORAGE FALLBACK — identical to the original implementation ──
    const db = getDB();
    setUsers(db.users);
    setTxns(db.transactions || []);
  };
  // ITEM 15: was mount-only — a second pending request submitted while this
  // tab was already open stayed invisible until a manual page reload. Same
  // polling shape BettorBoard already uses for matches; 15s here since real
  // money-approval visibility is higher-priority than match odds staleness.
  useEffect(() => {
    reload();
    const interval = setInterval(reload, 15000);
    return () => clearInterval(interval);
  }, []);

  // MIGRATION 6/6 — handleProcessTransaction now calls Supabase's
  // process_wallet_request RPC instead of directly mutating usr.balance and
  // t.status client-side. Per the migration doc, this was the single
  // riskiest item on the whole list: "Only 'admin' role in the UI gates
  // this — nothing stops a non-admin from calling the function directly via
  // devtools." The RPC is expected to re-check the caller's admin role
  // server-side (RLS / SECURITY DEFINER) rather than trust the UI gate,
  // re-validate the withdrawal balance check, and commit the balance change
  // + status flip atomically.
  // CORRECTED (was flagged ASSUMPTION) — param names p_transaction_id /
  // p_action were right, confirmed against the real function body. But
  // p_action only accepts the literal strings 'approved' or 'rejected'
  // (RAISE EXCEPTION otherwise) — the UI's button strings are "approve" /
  // "decline", so those get mapped right before the call rather than
  // renaming the buttons/localStorage fallback everywhere else that already
  // depends on "approve"/"decline".
  const handleProcessTransaction = async (txId, action) => {
    setErr(""); setMsg("");

    try {
      const rpcAction = action === "approve" ? "approved" : "rejected";
      const { data, error } = await supabase.rpc('process_wallet_request', {
        p_transaction_id: txId,
        p_action:         rpcAction,
      });
      if (error) throw error;
      if (!data?.success) { setErr(data?.message || `Could not ${action} transaction.`); return; }

      reload();
      setMsg(`Transaction ${action}d successfully.`);
      setTimeout(() => setMsg(""), 3000);
      return;
    } catch (err) {
      console.warn('[handleProcessTransaction] Supabase unavailable, using localStorage:', err.message);
    }

    // ── LOCALSTORAGE FALLBACK — identical to the original implementation ──
    const db  = getDB();
    const t   = db.transactions.find(x => x.id === txId);
    if (!t)          return setErr("Transaction not found.");
    const usr = db.users[t.userId];
    if (!usr)        return setErr("User not found.");

    if (action === "approve") {
      if (t.type === "withdrawal" && usr.balance < t.amount) {
        return setErr(`Insufficient balance for withdrawal: ${fmt(usr.balance)}`);
      }
      usr.balance = +(usr.balance + (t.type === "deposit" ? t.amount : -t.amount)).toFixed(2);
      t.status = "approved";
    } else {
      t.status = "declined";
    }

    saveDB(db); reload();
    setMsg(`Transaction ${action}d successfully.`);
    setTimeout(() => setMsg(""), 3000);
  };

  const pendingTx = txns.filter(t => t.status === "pending");
  const clearedTx = txns.filter(t => t.status !== "pending");

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>Liquidity Approvals Desk</h2>
        <p style={{ color: C.muted, margin: "4px 0 0", fontSize: 13 }}>
          Review deposit references and clear payouts against your ledger account.
        </p>
      </div>

      {err && <div style={{ color: C.red, background: C.red + "15", borderRadius: 6, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>{err}</div>}
      {msg && <div style={{ color: C.win, background: C.win + "15", borderRadius: 6, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>{msg}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24, alignItems: "start" }}>
        {/* Pending approvals */}
        <div style={styles.card}>
          <h3 style={{ margin: "0 0 16px", fontWeight: 700, color: C.yellow }}>
            Pending Authorisations ({pendingTx.length})
          </h3>
          {pendingTx.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13 }}>No pending requests.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {pendingTx.map(t => {
                const u = users[t.userId];
                return (
                  <div key={t.id} style={{ background: C.bg, padding: 14, borderRadius: 8, border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <div>
                        <strong style={{ fontSize: 14 }}>{u?.name || "Bettor"}</strong>
                        <div style={{ fontSize: 11, color: C.muted }}>Ref: {t.mpesa}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontWeight: 800, color: t.type === "deposit" ? C.accent : C.red }}>
                          {t.type === "deposit" ? "IN +" : "OUT -"}{fmt(t.amount)}
                        </span>
                        <div style={{ fontSize: 10, color: C.muted }}>Balance: {fmt(u?.balance || 0)}</div>
                      </div>
                    </div>
                    {t.note && <div style={{ fontSize: 12, fontStyle: "italic", color: C.purple, marginBottom: 10 }}>"{t.note}"</div>}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={{ ...styles.btn("primary", "sm"), flex: 1 }} onClick={() => handleProcessTransaction(t.id, "approve")}>Approve</button>
                      <button style={{ ...styles.btn("danger",  "sm"), flex: 1 }} onClick={() => handleProcessTransaction(t.id, "decline")}>Decline</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Settled clearings log */}
        <div style={styles.card}>
          <h3 style={{ margin: "0 0 16px", fontWeight: 700 }}>Settled Clearings Log</h3>
          {clearedTx.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13 }}>No cleared history yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto" }}>
              {[...clearedTx].reverse().map(t => {
                const u = users[t.userId];
                return (
                  <div key={t.id} style={{ background: C.bg, padding: 12, borderRadius: 8, borderLeft: `4px solid ${t.status === "approved" ? C.accent : C.red}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{u?.name || "Bettor"} ({t.type})</span>
                      <strong style={{ color: t.status === "approved" ? C.accent : C.muted }}>{t.status.toUpperCase()}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted }}>
                      <span>Ref: {t.mpesa} · {fmt(t.amount)}</span>
                      <span>{ts(t.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BETTOR BOARD (MATCH BOARD)
// ─────────────────────────────────────────────────────────────────────────────
function BettorBoard({ user, onAddSelection, activeSlipKeys }) {
  const [matches,      setMatches]      = useState([]);
  const [activeTabs,   setActiveTabs]   = useState({});
  // FIX: extra markets (GG/NG, O/U, Scoreline) hidden behind a toggle per match
  const [showMoreMkts, setShowMoreMkts] = useState({});
  // NEW: free-text search query for the bettor match board, filters by team name
  const [searchQuery,  setSearchQuery]  = useState("");

  useEffect(() => {
    const checkAndLock = async () => {
      const now = Date.now();

      // MIGRATION: try Supabase first
      try {
        const { data, error } = await supabase
          .from('matches')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        // Map Supabase row shape → existing UI shape (same mapping as
        // AdminMatches.reload, kept consistent so both components agree
        // on what a "match" object looks like throughout the app).
        // REVERTED (Session 8) — same fix as AdminMatches.reload's revert:
        // new live schema restores kickoff/mode/odds/home_stats/away_stats/
        // roster as real columns directly.
        const mapped = (data || []).map(m => ({
          id:        m.id,
          homeTeam:  m.home_team,
          awayTeam:  m.away_team,
          mode:      m.mode       || 'ml',
          kickoff:   m.kickoff    ? new Date(m.kickoff).getTime() : null,
          status:    m.status,
          odds:      m.odds       || {},
          homeStats: m.home_stats || {},
          awayStats: m.away_stats || {},
          roster:    m.roster     || { home: [], away: [] },
          result:    m.home_score !== null ? {
            homeGoals:  m.home_score,
            awayGoals:  m.away_score,
            outcome:    m.home_score > m.away_score ? 'home'
                      : m.away_score > m.home_score ? 'away' : 'draw',
          } : null,
          createdAt: new Date(m.created_at).getTime(),
        }));

        // NEW: auto-lock any open match whose kickoff time has passed.
        // Find them, write the status change to Supabase, then reflect
        // the change in the local mapped array so the UI updates without
        // waiting for the next poll.
        // REVERTED: 'scheduled'/'live'→'open'/'locked' — new live schema
        const toLock = mapped.filter(m => m.status === "open" && m.kickoff && now >= m.kickoff);
        if (toLock.length > 0) {
          await Promise.all(
            toLock.map(m =>
              supabase.from('matches').update({ status: 'locked' }).eq('id', m.id)
            )
          );
          toLock.forEach(m => { m.status = "locked"; });
        }

        setMatches(mapped);

        // Keep localStorage in sync so the fallback path stays fresh
        const db = getDB();
        db.matches = mapped;
        saveDB(db);

      } catch (err) {
        // Supabase failed — fall back to localStorage, same auto-lock logic as before
        console.warn('[BettorBoard] Supabase unavailable, using localStorage:', err.message);
        const db = getDB();
        let changed = false;

        db.matches = (db.matches || []).map(m => {
          // REVERTED: 'scheduled'/'live'→'open'/'locked'
          if (m.status === "open" && m.kickoff && now >= m.kickoff) {
            changed = true;
            return { ...m, status: "locked" };
          }
          return m;
        });

        if (changed) saveDB(db);
        setMatches(db.matches || []);
      }
    };

    checkAndLock(); // run immediately on mount
    const interval = setInterval(checkAndLock, 60000); // then every 60 seconds
    return () => clearInterval(interval); // clean up on unmount
  }, []);

  // UPGRADE: search combines with the existing "open status only" filter
  const boardQuery = searchQuery.trim().toLowerCase();
  const openFixtures = matches.filter(m => {
    if (m.status !== "open") return false; // REVERTED: was "scheduled"
    if (!boardQuery) return true;
    return m.homeTeam.toLowerCase().includes(boardQuery) || m.awayTeam.toLowerCase().includes(boardQuery);
  });

  const toggleTab = (matchId, tabId) =>
    setActiveTabs(prev => ({ ...prev, [matchId]: tabId }));

  const toggleMoreMarkets = (matchId) =>
    setShowMoreMkts(prev => ({ ...prev, [matchId]: !prev[matchId] }));

  // Reusable odds cell — highlights when the selection is in the active slip
  const renderMarketBtn = (match, outcomeKey, marketLabel, oddsValue, buttonColor = C.accent) => {
    const selectionKey = `${match.id}-${outcomeKey}`;
    const isSelected   = activeSlipKeys?.includes(selectionKey);

    return (
      <div key={outcomeKey}
        onClick={() => onAddSelection && onAddSelection(match, outcomeKey)}
        style={{ background: C.bg, borderRadius: 8, padding: "10px 8px", textAlign: "center", flex: 1,
          cursor: "pointer",
          border:     isSelected ? `2px solid ${buttonColor}` : `1px solid ${C.border}`,
          boxShadow:  isSelected ? `${buttonColor}22 0px 0px 8px` : "none",
          transition: "all 0.15s ease" }}>
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, letterSpacing: 0.5,
          textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
          {marketLabel}
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, color: buttonColor }}>
          {Number(oddsValue || 0).toFixed(2)}
        </div>
      </div>
    );
  };

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>Live Match Board</h2>
        <p style={{ color: C.muted, margin: "4px 0 0", fontSize: 13 }}>
          Click any odds cell to add it to your betslip. You can combine selections into an accumulator.
        </p>
      </div>

      {/* NEW: team name search */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ position: "relative", maxWidth: 360 }}>
          <input
            style={{ ...styles.input, paddingLeft: 36 }}
            placeholder="Search by team name…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 14, pointerEvents: "none" }}>🔍</span>
          {searchQuery && (
            <button onClick={() => setSearchQuery("")}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13 }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {openFixtures.length === 0 ? (
        <div style={{ ...styles.card, textAlign: "center", color: C.muted, padding: 40 }}>
          {/* FIX: distinguish "no matches at all" from "search found nothing" —
              previously this always showed the same message regardless of cause. */}
          {boardQuery ? (
            <>
              No open matches match "{searchQuery}".{" "}
              <button onClick={() => setSearchQuery("")} style={{ color: C.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: 13 }}>
                Clear search
              </button>
            </>
          ) : (
            "No active markets accepting bets currently."
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {openFixtures.map(m => {
            const currentTab   = activeTabs[m.id] || "btts";
            const moreOpen     = !!showMoreMkts[m.id];
            const o = m.odds || {};

            return (
              <div key={m.id} style={{ ...styles.card, border: `1px solid ${C.accent}33`, position: "relative" }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={styles.badge(C.accent)}>Open</span>
                    <span style={styles.badge(C.purple)}>{MODE_LABELS[m.mode] || m.mode}</span>
                    {/* SGM indicator: shows how many legs from this specific match
                        are currently in the betslip. With SGM enabled, a bettor
                        can have multiple picks on the same game across different
                        markets, so this count can exceed 1. */}
                    {(() => {
                      const matchLegs = (activeSlipKeys || []).filter(k => k.startsWith(`${m.id}-`));
                      return matchLegs.length > 0 ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 5,
                          background: C.accent + "22", border: `1px solid ${C.accent}55`,
                          borderRadius: 6, padding: "2px 8px" }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: C.accent }}>
                            {matchLegs.length} in slip
                          </span>
                        </div>
                      ) : null;
                    })()}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted }}>
                    {(() => {
                      // NEW: smart kickoff display — shows countdown when close
                      // to kickoff, static date/time when far away.
                      if (!m.kickoff) return "TBD";
                      const minsLeft = Math.floor((m.kickoff - Date.now()) / 60000);
                      if (minsLeft <= 0)  return <span style={{ color: C.muted }}>Kicked off</span>;
                      if (minsLeft <= 5)  return <span style={{ color: C.red,    fontWeight: 700 }}>⏱ Closes in {minsLeft}m</span>;
                      if (minsLeft <= 60) return <span style={{ color: C.yellow, fontWeight: 600 }}>⏱ Closes in {minsLeft}m</span>;
                      return ts(m.kickoff);
                    })()}
                  </div>
                </div>

                {/* Teams */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center", marginBottom: 14 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{m.homeTeam}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      ⭐ ATT {m.homeStats?.att || "—"} · {m.homeStats?.form || "—"}/5 form
                    </div>
                  </div>
                  <div style={{ textAlign: "center", fontWeight: 700, fontSize: 14, color: C.muted }}>VS</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{m.awayTeam}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      ⭐ ATT {m.awayStats?.att || "—"} · {m.awayStats?.form || "—"}/5 form
                    </div>
                  </div>
                </div>

                {/* Always-visible 1X2 main market */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  {renderMarketBtn(m, "home", `1 — ${m.homeTeam}`, o.home, C.accent)}
                  {renderMarketBtn(m, "draw", "X — Draw",           o.draw, C.yellow)}
                  {renderMarketBtn(m, "away", `2 — ${m.awayTeam}`, o.away, C.blue)}
                </div>

                {/* More Markets toggle button */}
                <button
                  onClick={() => toggleMoreMarkets(m.id)}
                  style={{ width: "100%", background: "none", border: `1px solid ${C.border}`,
                    borderRadius: 6, padding: "6px 0", color: C.muted, fontSize: 12,
                    fontWeight: 700, cursor: "pointer", marginBottom: moreOpen ? 12 : 0 }}>
                  {moreOpen ? "▲ Hide Markets" : "▼ More Markets (GG · Goals · Handicap · HT/FT · Lines · Score · Scorers)"}
                </button>

                {/* Extra markets — only shown when toggled open */}
                {moreOpen && (
                  <>
                    {/* Sub-market tabs */}
                    <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: 12, gap: 4, overflowX: "auto" }}>
                      {[
                        { id: "btts",      label: "⚽ GG/NG"        },
                        { id: "goals",     label: "🥅 Total Goals"  },
                        { id: "handicap",  label: "⚖️ Handicap"     },
                        { id: "htft",      label: "⏱️ HT/FT"        },
                        { id: "lines",     label: "📐 O/U Lines"    },
                        { id: "scores",    label: "🎯 Scoreline"    },
                        { id: "scorers",   label: "👤 Scorer/Assist" },
                      ].map(tab => (
                        <button key={tab.id} onClick={() => toggleTab(m.id, tab.id)}
                          style={{ padding: "6px 12px", background: "none", border: "none",
                            borderBottom: currentTab === tab.id ? `2px solid ${C.accent}` : "2px solid transparent",
                            color:  currentTab === tab.id ? C.accent : C.muted,
                            fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Tab: BTTS */}
                    {currentTab === "btts" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        {renderMarketBtn(m, "btts_yes", "GG — Both Score",  o.btts_yes || 1.95, C.accent)}
                        {renderMarketBtn(m, "btts_no",  "NG — Clean Sheet", o.btts_no  || 1.80, C.red)}
                      </div>
                    )}

                    {/* UPGRADE: Total Goals now shows three curated lines
                        (1.5 / 2.5 / 3.5) stacked, instead of a single
                        hardcoded 2.5 line — covers low/mid/high-scoring
                        expectations in one tab. */}
                    {currentTab === "goals" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {["1.5", "2.5", "3.5"].map(lineStr => {
                          const lineKey = lineStr.replace(".", "_");
                          const lineVal = o._totalGoalsLines?.[lineStr]?.line ?? Number(lineStr);
                          return (
                            <div key={lineStr} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <div style={{ minWidth: 60, fontSize: 11, fontWeight: 700, color: C.muted }}>
                                🥅 {lineVal}:
                              </div>
                              {renderMarketBtn(m, `total_${lineKey}_over`,  `Over ${lineVal}`,  o[`total_${lineKey}_over`]  || 1.90, C.accent)}
                              {renderMarketBtn(m, `total_${lineKey}_under`, `Under ${lineVal}`, o[`total_${lineKey}_under`] || 1.90, C.blue)}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* NEW Tab: Asian Handicap — main line (auto-balanced
                        from the xG gap) plus two alternates. Push only
                        renders if the line is a whole number and the push
                        outcome actually exists for it. */}
                    {currentTab === "handicap" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {["main", "alt1", "alt2"].map(slot => {
                          const lineVal = o._handicapLines?.[slot];
                          if (lineVal === undefined) return null;
                          const sign = lineVal > 0 ? "+" : "";
                          const pushOdds = o[`handicap_${slot}_push`];
                          return (
                            <div key={slot} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <div style={{ minWidth: 70, fontSize: 11, fontWeight: 700, color: C.muted }}>
                                {slot === "main" ? "⭐" : ""} {sign}{lineVal}:
                              </div>
                              {renderMarketBtn(m, `handicap_${slot}_home`, `${m.homeTeam} ${sign}${lineVal}`, o[`handicap_${slot}_home`] || 1.90, C.accent)}
                              {renderMarketBtn(m, `handicap_${slot}_away`, `${m.awayTeam} ${sign > "" ? "-" : "+"}${Math.abs(lineVal)}`, o[`handicap_${slot}_away`] || 1.90, C.blue)}
                              {pushOdds && renderMarketBtn(m, `handicap_${slot}_push`, "Push (refund)", pushOdds, C.muted)}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Tab: Half-Time / Full-Time — 9 combos in a 3x3 grid
                        matching the natural HT(rows) x FT(cols) layout punters expect */}
                    {currentTab === "htft" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                        {["home", "draw", "away"].map(h =>
                          ["home", "draw", "away"].map(f => {
                            const key = `htft_${h}_${f}`;
                            const lbl = `${h === "home" ? "1" : h === "draw" ? "X" : "2"}/${f === "home" ? "1" : f === "draw" ? "X" : "2"}`;
                            return renderMarketBtn(m, key, `HT/FT: ${lbl}`, o[key] || 10, C.purple);
                          })
                        )}
                      </div>
                    )}

                    {/* Tab: Over/Under lines */}
                    {currentTab === "lines" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <div style={{ minWidth: 100, fontSize: 11, fontWeight: 700, color: C.muted }}>
                            📐 Corners {o._cornerLine || 8.5}:
                          </div>
                          {renderMarketBtn(m, "corners_over",  `Over ${o._cornerLine || 8.5}`,  o.corners_over  || 1.85, C.accent)}
                          {renderMarketBtn(m, "corners_under", `Under ${o._cornerLine || 8.5}`, o.corners_under || 1.85, C.blue)}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <div style={{ minWidth: 100, fontSize: 11, fontWeight: 700, color: C.muted }}>
                            🟨 Cards {o._cardLine || 3.5}:
                          </div>
                          {renderMarketBtn(m, "cards_over",  `Over ${o._cardLine || 3.5}`,  o.cards_over  || 2.10, C.purple)}
                          {renderMarketBtn(m, "cards_under", `Under ${o._cardLine || 3.5}`, o.cards_under || 1.65, C.yellow)}
                        </div>
                      </div>
                    )}

                    {/* Tab: Correct Score */}
                    {currentTab === "scores" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                        {Object.entries(o.correctScores || {
                          "1-0": 6.50, "2-0": 8.00, "2-1": 9.00,
                          "0-1": 7.50, "0-2": 11.0, "1-2": 10.5,
                          "0-0": 9.50, "1-1": 6.00, "2-2": 14.0,
                        }).map(([scoreStr, oddsVal]) =>
                          renderMarketBtn(m, `score_${scoreStr.replace("-", "_")}`, `Score: ${scoreStr}`, oddsVal, C.text)
                        )}
                      </div>
                    )}

                    {/* NEW Tab: Anytime Scorer / Assist — split by team since
                        rosters can run long; falls back to a friendly empty
                        state if the admin didn't enter a roster for this match. */}
                    {currentTab === "scorers" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, marginBottom: 6 }}>
                            ⚽ {m.homeTeam} — Anytime Scorer
                          </div>
                          {m.roster?.home?.length ? (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                              {m.roster.home.map(name =>
                                renderMarketBtn(m, `scorer_home_${name}`, name, o[`scorer_home_${name}`] || 5, C.accent)
                              )}
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: C.muted }}>No roster entered for {m.homeTeam}.</div>
                          )}
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>
                            ⚽ {m.awayTeam} — Anytime Scorer
                          </div>
                          {m.roster?.away?.length ? (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                              {m.roster.away.map(name =>
                                renderMarketBtn(m, `scorer_away_${name}`, name, o[`scorer_away_${name}`] || 5, C.blue)
                              )}
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: C.muted }}>No roster entered for {m.awayTeam}.</div>
                          )}
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, marginBottom: 6 }}>
                            🅰️ Anytime Assist — Either Team
                          </div>
                          {(m.roster?.home?.length || m.roster?.away?.length) ? (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                              {(m.roster?.home || []).map(name =>
                                renderMarketBtn(m, `assist_home_${name}`, `${name} (H)`, o[`assist_home_${name}`] || 6, C.purple)
                              )}
                              {(m.roster?.away || []).map(name =>
                                renderMarketBtn(m, `assist_away_${name}`, `${name} (A)`, o[`assist_away_${name}`] || 6, C.purple)
                              )}
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: C.muted }}>No roster entered for this match.</div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BETSLIP BASKET
// FIX: the compound odds calculation used `item.match.odds[item.outcome]` which
// now works because match.odds is a flat object.  Previously this would return
// undefined for btts/corners/cards/score outcomes that live in nested trees.
// UPGRADE: added per-selection odds display in the summary row.
// ─────────────────────────────────────────────────────────────────────────────
function BetslipBasket({ selections, onRemove, onClear, userBalance, onConfirmBets, onAcceptOddsChange, maxStakeLimit }) {
  const [stake,       setStake]       = useState("");
  const [slipErr,     setSlipErr]     = useState("");
  const [slipSuccess, setSlipSuccess] = useState("");
  const [hidden,      setHidden]      = useState(false);
  // MIGRATION: tracks whether a place_bet request is in flight, so the
  // button can be disabled to prevent a double-click firing two requests
  // during the round-trip to Supabase.
  const [submitting,  setSubmitting]  = useState(false);

  // NEW: track viewport width to switch between desktop panel and mobile sheet
  const windowWidth = useWindowWidth();
  const isMobile    = windowWidth < 640;

  // NEW: panel style switches between a full-width bottom sheet on mobile
  // and the existing fixed right-side panel on desktop.
  const panelStyle = isMobile
    ? { position: "fixed", bottom: 0, left: 0, right: 0, width: "100%", background: C.surface,
        border: "none", borderTop: `2px solid ${C.accent}`, borderRadius: "16px 16px 0 0",
        boxShadow: "0 -8px 32px rgba(0,0,0,0.6)", zIndex: 2000, overflow: "hidden" }
    : { position: "fixed", right: 24, bottom: 24, width: 340, background: C.surface,
        border: `2px solid ${C.accent}`, borderRadius: 14,
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)", zIndex: 1000, overflow: "hidden" };

  // Always render the toggle tab so bettor can reopen — only hide the body.
  // NEW: tab also adapts — full-width bottom bar on mobile vs floating pill on desktop.
  const tabStyle = isMobile
    ? { position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface,
        borderTop: `2px solid ${C.accent}`, padding: "12px 20px", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        fontWeight: 700, fontSize: 13, color: C.accent, zIndex: 2000 }
    : { position: "fixed", right: 24, bottom: 24, zIndex: 1001,
        background: C.surface, border: `2px solid ${C.accent}`, borderRadius: 10,
        padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center",
        gap: 8, fontWeight: 700, fontSize: 13, color: C.accent,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)" };

  if (selections.length === 0) return null;

  // Now all sub-market odds sit as flat keys on match.odds so direct lookup works
  const totalOdds = selections.reduce((acc, item) => {
    const legOdds = item.match.odds?.[item.outcome] || 1;
    return acc * legOdds;
  }, 1);

  // NEW (CHANGE 014): a leg flagged stale by the odds-watch effect must be
  // resolved (accepted or removed) before the slip can be placed — the
  // bettor shouldn't be able to lock in a bet against odds that just
  // changed without seeing it.
  const hasStaleLeg = selections.some(item => item.stale);

  // NEW (CHANGE 018): the tighter of the platform ceiling and the
  // bettor's own personal limit (if they've set one) — mirrors exactly
  // what place_bet enforces server-side, so the client-side message
  // matches what would actually happen on submit.
  const effectiveMaxStake = maxStakeLimit ? Math.min(MAX_STAKE, maxStakeLimit) : MAX_STAKE;

  const numericStake    = Number(stake) || 0;
  const potentialPayout = numericStake * totalOdds;

  const handleSubmitSlip = async () => {
    setSlipErr(""); setSlipSuccess("");
    if (hasStaleLeg)                return setSlipErr("Odds changed on one of your selections — accept or remove it below before placing.");
    if (numericStake <= 0)          return setSlipErr("Enter a valid stake amount.");
    if (numericStake > effectiveMaxStake) return setSlipErr(`Maximum stake is ${fmt(effectiveMaxStake)}${maxStakeLimit ? " (your personal limit)" : ""}.`);
    if (numericStake > userBalance) return setSlipErr("Insufficient wallet funds.");

    setSubmitting(true);
    const res = await onConfirmBets(numericStake, totalOdds);
    setSubmitting(false);

    if (res.success) {
      setSlipSuccess("Wager placed successfully!");
      setStake("");
      setTimeout(() => { setSlipSuccess(""); onClear(); }, 2000);
    } else {
      setSlipErr(res.msg);
    }
  };

  return (
    <>
      {/* Collapsed tab — always visible so bettor can reopen */}
      {hidden && (
        <div style={tabStyle} onClick={() => setHidden(false)}>
          {isMobile ? (
            <>
              <span>🛒 Betslip ({selections.length})</span>
              <span>▲</span>
            </>
          ) : (
            <>🛒 Betslip ({selections.length}) ▲</>
          )}
        </div>
      )}

      {/* Full betslip panel */}
      {!hidden && (
    <div style={panelStyle}>

      {/* Header */}
      <div style={{ background: C.card, padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 16 }}>🛒</span>
          <strong style={{ fontSize: 14, color: C.accent }}>BETSLIP ({selections.length})</strong>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={() => setHidden(true)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
            Hide ▼
          </button>
          <button onClick={onClear} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
            Clear All
          </button>
        </div>
      </div>

      {/* Selections — NEW: slightly shorter max-height on mobile to leave
          more room for the stake input above the fold */}
      <div style={{ padding: 14, maxHeight: isMobile ? 160 : 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, background: C.bg }}>
        {selections.map(item => {
          // NEW (CHANGE 014): a stale leg gets its own card — old odds
          // struck through, new odds highlighted, explicit Accept/Remove.
          // No auto-resolution either way; the bettor must act.
          if (item.stale) {
            return (
              <div key={`${item.match.id}-${item.outcome}`}
                style={{ background: C.yellow + "12", padding: 10, borderRadius: 8, border: `1px solid ${C.yellow}55` }}>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                  {item.match.homeTeam} v {item.match.awayTeam}
                </div>
                <div style={{ fontSize: 11, color: C.yellow, fontWeight: 700, marginBottom: 6 }}>
                  ⚠ Odds changed for {formatOutcomeLabel(item.outcome)}:{" "}
                  <span style={{ textDecoration: "line-through", color: C.muted }}>{fmtOdds(item.stale.oldOdds)}</span>
                  {" → "}
                  <span style={{ color: C.text }}>{fmtOdds(item.stale.newOdds)}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => onAcceptOddsChange(item.match.id, item.outcome)}
                    style={{ ...styles.btn("primary", "sm"), flex: 1 }}>
                    ✓ Accept New Odds
                  </button>
                  <button onClick={() => onRemove(item.match.id, item.outcome)}
                    style={{ ...styles.btn("ghost", "sm"), flex: 1 }}>
                    Remove
                  </button>
                </div>
              </div>
            );
          }
          const legOdds = item.match.odds?.[item.outcome] || 1;
          return (
            <div key={`${item.match.id}-${item.outcome}`}
              style={{ background: C.card, padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, position: "relative" }}>
              <button onClick={() => onRemove(item.match.id, item.outcome)}
                style={{ position: "absolute", right: 8, top: 8, background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>
                ✕
              </button>
              <div style={{ fontWeight: 700, fontSize: 12, paddingRight: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {item.match.homeTeam} v {item.match.awayTeam}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, fontSize: 11 }}>
                <span style={{ color: C.yellow, fontWeight: 600 }}>{formatOutcomeLabel(item.outcome)}</span>
                <span style={{ color: C.accent, fontWeight: 700 }}>@ {fmtOdds(legOdds)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: 16, background: C.surface, borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, fontSize: 14 }}>
          <span style={{ color: C.muted, fontWeight: 600 }}>
            {selections.length > 1 ? "Acca" : "Single"} Odds:
          </span>
          <strong style={{ color: C.accent, fontSize: 16 }}>{fmtOdds(totalOdds)}</strong>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={styles.label}>Stake Amount</label>
            <input style={styles.input} type="number" min="1" placeholder={`KES (max ${fmt(effectiveMaxStake)})`}
              value={stake} onChange={e => setStake(e.target.value)} />
          </div>

          {numericStake > 0 && (
            <div style={{ padding: "8px 10px", background: C.accent + "11", borderRadius: 6, fontSize: 12, border: `1px solid ${C.accent}22` }}>
              <span style={{ color: C.muted }}>Potential Return:</span>{" "}
              <strong style={{ color: C.win }}>{fmt(potentialPayout)}</strong>
            </div>
          )}

          {/* UPGRADE: show available balance so bettor knows their limit */}
          <div style={{ fontSize: 11, color: C.muted, textAlign: "right" }}>
            Available: <strong style={{ color: C.text }}>{fmt(userBalance)}</strong>
          </div>

          {slipErr     && <div style={{ color: C.red, fontSize: 12 }}>{slipErr}</div>}
          {slipSuccess && <div style={{ color: C.win, fontSize: 12, fontWeight: 600 }}>{slipSuccess}</div>}

          <button style={{ ...styles.btn("primary"), width: "100%", padding: "11px 0", opacity: (submitting || hasStaleLeg) ? 0.6 : 1 }}
            onClick={handleSubmitSlip} disabled={submitting || hasStaleLeg}>
            {submitting ? "⏳ Placing…" : hasStaleLeg ? "⚠ Resolve odds changes above" : `🔒 Place ${selections.length > 1 ? "Accumulator" : "Bet"}`}
          </button>
        </div>
      </div>
    </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BETTOR MY BETS
// ─────────────────────────────────────────────────────────────────────────────
function BettorMyBets({ user, onCashOut }) {
  const [myBets,  setMyBets]  = useState([]);
  const [matches, setMatches] = useState({});
  // NEW: track which bet is showing the cash-out confirm UI (betId or null)
  const [cashOutPending, setCashOutPending] = useState(null);

  // MIGRATION 9a: previously only read getDB().bets, which nothing writes to
  // anymore now that App.handleConfirmMultiBet calls the real place_bet RPC.
  // Pulls bets joined with bet_legs (the schema's per-selection table) in one
  // call, plus a lightweight matches fetch just for home/away team names.
  const reload = async () => {
    try {
      const { data: betRows, error: betErr } = await supabase
        .from('bets')
        .select('*, bet_legs(*)')
        .eq('user_id', user.uid)
        .order('created_at', { ascending: false });
      if (betErr) throw betErr;

      const { data: matchRows, error: matchErr } = await supabase
        .from('matches')
        .select('id, home_team, away_team');
      if (matchErr) throw matchErr;

      const matchMap = (matchRows || []).reduce((acc, m) => {
        acc[m.id] = { homeTeam: m.home_team, awayTeam: m.away_team };
        return acc;
      }, {});

      const mappedBets = (betRows || []).map(b => ({
        id:       b.id,
        userId:   b.user_id,
        // Schema uses 'pending' for an unsettled bet; every render check in
        // this component compares against 'active', so translate once here
        // rather than touching every status check below.
        status:   b.status === 'pending' ? 'active' : b.status,
        isSGM:    b.is_sgm,
        stake:    Number(b.stake),
        odds:     Number(b.total_odds),
        payout:   b.actual_payout != null ? Number(b.actual_payout) : undefined,
        selections: (b.bet_legs || []).map(leg => ({
          matchId: leg.match_id,
          outcome: leg.selection,
          odds:    Number(leg.odds_at_placement),
          // bet_legs.status is 'pending'/'won'/'lost'/'voided'/'push'. This
          // component's per-leg color check looks for the literal string
          // 'void' (not 'voided') — translating here keeps that render
          // logic untouched.
          result:  leg.status === 'pending' ? undefined
                  : leg.status === 'voided' ? 'void'
                  : leg.status,
        })),
        createdAt: new Date(b.created_at).getTime(),
      }));

      setMyBets(mappedBets);
      setMatches(matchMap);
      return;
    } catch (err) {
      console.warn('[BettorMyBets.reload] Supabase unavailable, using localStorage:', err.message);
    }

    // ── LOCALSTORAGE FALLBACK — identical to the original implementation ──
    const db = getDB();
    const filteredBets = (db.bets || []).filter(b => b.userId === user.uid);
    const matchMapFallback = (db.matches || []).reduce((acc, m) => { acc[m.id] = m; return acc; }, {});
    setMyBets([...filteredBets].reverse());
    setMatches(matchMapFallback);
  };

  // ITEM 15: mount-only before — a bettor's "My Bets" tab wouldn't reflect
  // a settlement (active → won/lost) or a cash-out from another tab until
  // manually reloaded. Same 15s cadence as the wallet screens.
  useEffect(() => {
    reload();
    const interval = setInterval(reload, 15000);
    return () => clearInterval(interval);
  }, [user.uid]);

  // UPGRADE: summary stats row at the top
  const totalStaked = myBets.reduce((a, b) => a + b.stake, 0);
  const totalWon    = myBets.filter(b => b.status === "won").reduce((a, b) => a + b.stake * b.odds, 0);
  const activeBets  = myBets.filter(b => b.status === "active").length;

  const settledBets    = myBets.filter(b => b.status === "won" || b.status === "lost");
  const settledReturns = settledBets.filter(b => b.status === "won").reduce((a, b) => a + b.stake * b.odds, 0);
  const settledStaked  = settledBets.reduce((a, b) => a + b.stake, 0);
  const netPnl         = +(settledReturns - settledStaked).toFixed(2);

  // NEW: compute cash-out offer value for a given active bet.
  // Option A (static partial): value depends on how many legs have already won.
  //   - Single / no legs settled yet → 85% of stake (small discount, risk still open)
  //   - Accumulator with some won legs → (wonLegs/totalLegs) × potentialReturn × 0.75
  //   - All legs won (shouldn't be "active" but guard anyway) → 90% of full payout
  // The house keeps 15-25% as the early-settlement fee, matching real sportsbook norms.
  const calcCashOut = (b) => {
    if (b.status !== "active") return 0;
    const potentialReturn = b.stake * b.odds;
    const legs    = b.selections || [];
    const wonLegs = legs.filter(s => s.result === "won").length;
    const total   = legs.length;

    if (total === 0) return +(potentialReturn * 0.75).toFixed(2); // single bet
    if (wonLegs === 0) return +(b.stake * 0.85).toFixed(2);       // no progress yet
    if (wonLegs === total) return +(potentialReturn * 0.90).toFixed(2); // all won
    return +(potentialReturn * (wonLegs / total) * 0.75).toFixed(2);   // partial progress
  };

  // Ripple from MIGRATION 4/6: onCashOut now awaits an async Supabase RPC
  // (see App.handleCashOut), so this needs to await it too — same pattern
  // as handleSubmitSlip awaiting onConfirmBets for place_bet.
  const confirmCashOut = async (bet) => {
    const value = calcCashOut(bet);
    const ok = await onCashOut(bet.id, value);
    if (!ok) return;
    setCashOutPending(null);
    reload();
  };

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>My Bets</h2>
      </div>

      {/* UPGRADE: quick stats for the bettor */}
      {myBets.length > 0 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
          <StatCard label="Total Staked"  value={fmt(totalStaked)} accent={C.text} />
          <StatCard label="Total Returns" value={fmt(totalWon)}    accent={C.win}  />
          <StatCard label="Active Bets"   value={activeBets}       accent={C.yellow} />
          {/* NEW: net profit/loss across settled bets only */}
          <StatCard label="Net P&L" value={fmt(netPnl)} accent={netPnl >= 0 ? C.win : C.red} sub="settled bets only" />
        </div>
      )}

      {myBets.length === 0 ? (
        <div style={{ ...styles.card, color: C.muted, textAlign: "center" }}>No bets placed yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {myBets.map(b => {
            const items = b.selections || [{ matchId: b.matchId, outcome: b.outcome, odds: b.odds }];
            const betStatusColor =
              b.status === "won"       ? C.win    :
              b.status === "lost"      ? C.red    :
              b.status === "voided"    ? C.muted  :
              b.status === "cashedout" ? C.yellow : C.yellow;

            return (
              <div key={b.id} style={{ ...styles.card, borderLeft: `4px solid ${betStatusColor}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <strong style={{ fontSize: 12, color: C.purple, letterSpacing: 0.5 }}>
                      {b.isSGM
                        ? `SGM (${items.length} legs)`
                        : items.length > 1
                          ? `ACCUMULATOR (${items.length} legs)`
                          : "SINGLE"}
                    </strong>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                      {items.map((it, idx) => {
                        const m = matches[it.matchId] || {};
                        // UPGRADE: show per-leg settlement status when available
                        const legStatus = it.result;
                        return (
                          <div key={idx} style={{ fontSize: 13 }}>
                            ⚽ {m.homeTeam || "?"} v {m.awayTeam || "?"} —{" "}
                            <span style={{ color: C.yellow }}>{formatOutcomeLabel(it.outcome)} @ {fmtOdds(it.odds)}</span>
                            {legStatus && (
                              <span style={{ marginLeft: 6, fontSize: 11,
                                color: legStatus === "won" ? C.win : (legStatus === "void" || legStatus === "push") ? C.muted : C.red }}>
                                [{legStatus.toUpperCase()}]
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <span style={styles.badge(betStatusColor)}>{b.status}</span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", background: C.bg,
                  padding: 10, borderRadius: 8, fontSize: 13, marginTop: 8 }}>
                  <div><span style={{ color: C.muted }}>Stake:</span> <strong>{fmt(b.stake)}</strong></div>
                  <div>
                    <span style={{ color: C.muted }}>
                      {b.status === "voided"    ? "Refunded:"
                       : b.status === "cashedout" ? "Cashed Out:"
                       : b.status === "won"       ? "Won:"
                       : b.status === "lost"      ? "Lost:"
                       : "Potential Return:"}
                    </span>{" "}
                    <strong style={{ color:
                        b.status === "won"       ? C.win    :
                        b.status === "cashedout" ? C.yellow :
                        b.status === "voided"    ? C.muted  :
                        b.status === "lost"      ? C.red    : C.text }}>
                      {b.status === "voided"    ? fmt(b.payout ?? b.stake)
                       : b.status === "cashedout" ? fmt(b.payout ?? 0)
                       : b.status === "lost"      ? fmt(0)
                       : fmt(+(b.stake * b.odds).toFixed(2))}
                    </strong>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: C.muted, marginTop: 6, textAlign: "right" }}>
                  Placed: {ts(b.createdAt)}
                </div>

                {/* NEW: cash-out button — only for active bets. Two-step
                    confirm matches the settle-desk pattern. */}
                {b.status === "active" && (() => {
                  const offer = calcCashOut(b);
                  const isArmed = cashOutPending === b.id;
                  return (
                    <div style={{ marginTop: 12 }}>
                      {!isArmed ? (
                        <button
                          onClick={() => setCashOutPending(b.id)}
                          style={{ ...styles.btn("yellow", "sm"), width: "100%" }}>
                          💰 Cash Out — {fmt(offer)}
                        </button>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ fontSize: 12, color: C.yellow, background: C.yellow + "15",
                            borderRadius: 6, padding: "8px 12px", textAlign: "center" }}>
                            Accept <strong>{fmt(offer)}</strong> and close this bet early?
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => confirmCashOut(b)}
                              style={{ ...styles.btn("primary", "sm"), flex: 1 }}>
                              ✅ Yes — Take {fmt(offer)}
                            </button>
                            <button onClick={() => setCashOutPending(null)}
                              style={{ ...styles.btn("ghost", "sm"), flex: 1 }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BETTOR WALLET
// ─────────────────────────────────────────────────────────────────────────────
function BettorWallet({ user }) {
  // MIGRATION 9b (completion): these four were referenced throughout this
  // component (reload()'s setHistory, handleCreateRequest's form/setErr/
  // setMsg, and the Statement/New Request JSX below) but never declared —
  // and reload() was never actually invoked on mount. Without these the
  // component throws a ReferenceError on first render.
  const [history, setHistory] = useState([]);
  const [form,    setForm]    = useState({ type: "deposit", amount: "", mpesa: "", note: "" });
  const [err,     setErr]     = useState("");
  const [msg,     setMsg]     = useState("");

  const reload = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.uid)
        .order('created_at', { ascending: false });
      if (error) throw error;

      setHistory((data || []).map(t => ({
        id:        t.id,
        userId:    t.user_id,
        type:      t.type,
        amount:    Number(t.amount),
        mpesa:     t.mpesa_code,
        note:      t.note,
        status:    t.status,
        createdAt: new Date(t.created_at).getTime(),
      })));
      return;
    } catch (err) {
      console.warn('[BettorWallet.reload] Supabase unavailable, using localStorage:', err.message);
    }

    // ── LOCALSTORAGE FALLBACK — identical to the original implementation ──
    const db = getDB();
    setHistory([...(db.transactions || []).filter(t => t.userId === user.uid)].reverse());
  };

  // WIRED (Session 8, item 9) — create_wallet_request genuinely exists in
  // the new live schema (confirmed from the deployed function body the user
  // pasted). Signature is (p_type, p_amount, p_mpesa_code, p_note) — no
  // p_user_id, the RPC reads auth.uid() internally. Client checks below stay
  // as a fast pre-flight courtesy; the RPC re-validates server-side
  // regardless (including its own `p_amount < 10` floor, which applies to
  // BOTH deposit and withdrawal server-side — slightly stricter than this
  // client's own check, which only floors deposits; flagged in tracker, not
  // fixed here since it's a minor UX-only edge case).
  // KNOWN GAP (not fixed here, tracked separately): for a withdrawal, this
  // RPC pre-debits the balance server-side immediately. This app's
  // displayed `user.balance` only ever comes from getFreshUser() reading
  // localStorage — there's no profile-read migration yet, so the displayed
  // balance won't reflect the server-side pre-debit until something
  // refreshes it. See MIGRATION_TRACKER.md.
  const handleCreateRequest = async () => {
    setErr(""); setMsg("");
    const amt = Number(form.amount);
    if (!amt || amt <= 0)       return setErr("Enter a valid amount.");
    if (form.type === "deposit" && amt < MIN_DEPOSIT) {
      return setErr(`Minimum deposit is ${fmt(MIN_DEPOSIT)}.`);
    }
    if (!form.mpesa.trim())     return setErr("Enter your M-Pesa receipt code.");
    if (form.type === "withdrawal" && user.balance < amt) {
      return setErr("Insufficient balance for this withdrawal.");
    }

    try {
      const { data, error } = await supabase.rpc('create_wallet_request', {
        p_type:       form.type,
        p_amount:     amt,
        p_mpesa_code: form.mpesa.trim().toUpperCase(),
        p_note:       form.note.trim() || null,
      });
      if (error) throw error;
      if (!data?.success) { setErr(data?.message || "Request could not be submitted."); return; }

      reload();
      setForm({ type: "deposit", amount: "", mpesa: "", note: "" });
      setMsg("Request submitted. Awaiting admin approval.");
      setTimeout(() => setMsg(""), 4000);
      return;
    } catch (err) {
      console.warn('[handleCreateRequest] Supabase unavailable, using localStorage:', err.message);
    }

    // ── LOCALSTORAGE FALLBACK — identical to the original implementation ──
    const db = getDB();
    db.transactions = [...(db.transactions || []), {
      id:        "tx_" + Date.now(),
      userId:    user.uid,
      type:      form.type,
      amount:    amt,
      mpesa:     form.mpesa.trim().toUpperCase(),
      note:      form.note.trim(),
      status:    "pending",
      createdAt: Date.now(),
    }];
    saveDB(db); reload();
    setForm({ type: "deposit", amount: "", mpesa: "", note: "" });
    setMsg("Request submitted. Awaiting admin approval.");
    setTimeout(() => setMsg(""), 4000);
  };

  // ITEM 15: mount-only before — a bettor wouldn't see their request flip
  // from "pending" to "approved"/"declined" until they manually reloaded.
  // Same 15s cadence as AdminWallets since this is the other side of the
  // same money flow.
  useEffect(() => {
    reload();
    const interval = setInterval(reload, 15000);
    return () => clearInterval(interval);
  }, [user.uid]);

  return (
    <div style={styles.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>My Wallet</h2>
          <p style={{ color: C.muted, margin: "4px 0 0", fontSize: 13 }}>Submit deposit or withdrawal references for admin approval.</p>
        </div>
        <div style={{ ...styles.card, padding: "14px 24px", background: C.surface, textAlign: "right" }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Available Balance</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: C.accent }}>{fmt(user.balance)}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 24 }}>
        {/* Request form */}
        <div style={styles.card}>
          <h3 style={{ margin: "0 0 16px", fontWeight: 700 }}>New Request</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={styles.label}>Type</label>
              <div style={{ display: "flex", gap: 8 }}>
                {["deposit", "withdrawal"].map(t => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", cursor: "pointer",
                      fontWeight: 700, fontSize: 13, textTransform: "capitalize",
                      background: form.type === t ? (t === "deposit" ? C.accent : C.red) : C.bg,
                      color:      form.type === t ? C.bg : C.muted }}>
                    {t === "deposit" ? "Deposit" : "Withdraw"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={styles.label}>Amount (KES)</label>
              <input style={styles.input} type="number" min={form.type === "deposit" ? MIN_DEPOSIT : 1}
                placeholder={form.type === "deposit" ? `e.g. 500 (min ${fmt(MIN_DEPOSIT)})` : "e.g. 500"} value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>M-Pesa Code</label>
              <input style={styles.input} placeholder="e.g. SFI789XJ44" value={form.mpesa}
                onChange={e => setForm(f => ({ ...f, mpesa: e.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Note (optional)</label>
              <input style={styles.input} placeholder="Any extra info for admin" value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </div>
            {err && <div style={{ color: C.red, fontSize: 12 }}>{err}</div>}
            {msg && <div style={{ color: C.win, fontSize: 12 }}>{msg}</div>}
            <button style={{ ...styles.btn("primary"), padding: "12px 0" }} onClick={handleCreateRequest}>
              Submit Request
            </button>
          </div>
        </div>

        {/* Statement */}
        <div style={styles.card}>
          <h3 style={{ margin: "0 0 16px", fontWeight: 700 }}>Statement</h3>
          {history.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13 }}>No transactions yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.map(t => (
                <div key={t.id} style={{ background: C.bg, padding: 12, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, textTransform: "capitalize" }}>
                      {t.type}{" "}
                      <span style={{ fontSize: 11, fontWeight: 400,
                        color: t.status === "pending" ? C.yellow : t.status === "approved" ? C.win : C.red }}>
                        ({t.status})
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      Ref: {t.mpesa} · {ts(t.createdAt)}
                    </div>
                  </div>
                  <strong style={{ color: t.type === "deposit" ? C.win : C.red }}>
                    {t.type === "deposit" ? "+" : "-"}{fmt(t.amount)}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS — password change only for now. Dark/light theme toggle is
// deliberately paused (not forgotten) — a real toggle needs a second theme
// token set and a small context so components read "current theme" instead
// of the hardcoded C object everywhere; parking that until asked for.
// ─────────────────────────────────────────────────────────────────────────────
// NEW (CHANGE 017): the 8 bettor-facing notification types that can be
// muted. wallet_request_pending (admin-only) deliberately excluded — an
// admin muting "new deposit request" defeats the point of that role.
// Single source of truth shared by SettingsPanel's toggle UI and
// NotificationBell's filtering, so they can never drift out of sync.
const MUTABLE_NOTIFICATION_TYPES = [
  { type: "bet_won",              label: "Bet won" },
  { type: "bet_lost",             label: "Bet lost" },
  { type: "bet_voided",           label: "Bet voided / refunded" },
  { type: "bet_cashedout",        label: "Cash-out confirmed" },
  { type: "deposit_approved",     label: "Deposit approved" },
  { type: "deposit_rejected",     label: "Deposit rejected" },
  { type: "withdrawal_approved",  label: "Withdrawal approved" },
  { type: "withdrawal_rejected",  label: "Withdrawal rejected" },
];

// NEW (CHANGE 019): the 8 bookmaker margins, matching platform_settings.
// odds_margins' keys and suggestOdds's M object exactly.
const MARGIN_FIELDS = [
  { key: "main_line",     label: "1X2 (Main Line)" },
  { key: "btts",          label: "Both Teams to Score" },
  { key: "total_goals",   label: "Total Goals O/U" },
  { key: "handicap",      label: "Asian Handicap" },
  { key: "ht_ft",         label: "Half-Time / Full-Time" },
  { key: "correct_score", label: "Correct Score" },
  { key: "scorer",        label: "Anytime Scorer" },
  { key: "assist",        label: "Anytime Assist" },
];

function SettingsPanel({ user, onNotificationPrefsChange, onMaxStakeChange }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword,     setNewPassword]      = useState("");
  const [confirmPassword, setConfirmPassword]  = useState("");
  const [showPass,        setShowPass]         = useState(false);
  const [err,             setErr]              = useState("");
  const [msg,             setMsg]              = useState("");
  const [loading,         setLoading]          = useState(false);

  const handleChangePassword = async () => {
    setErr(""); setMsg("");
    if (!currentPassword) return setErr("Enter your current password.");
    if (newPassword.length < 6) return setErr("New password must be at least 6 characters.");
    if (newPassword !== confirmPassword) return setErr("New passwords don't match.");

    setLoading(true);
    // Re-authenticate with the CURRENT password first. supabase.auth.updateUser()
    // will happily change the password of whatever session is active right now
    // without ever asking for the old one — fine for a user acting on their own
    // account, but it means anyone at an already-logged-in device could lock
    // the real owner out. Confirming the current password first closes that gap.
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (reauthErr) { setErr("Current password is incorrect."); setLoading(false); return; }

    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    if (updateErr) { setErr(updateErr.message); setLoading(false); return; }

    setMsg("Password updated successfully.");
    setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    setLoading(false);
  };

  // NEW (CHANGE 017): notification mute preferences. Local state seeded
  // from the user prop so toggles render instantly; a type is "on" unless
  // explicitly set to false (matches the schema's "empty object = all
  // enabled" default).
  const [prefs,       setPrefs]       = useState(user.notification_prefs || {});
  const [prefsSaving, setPrefsSaving] = useState(false);

  const toggleNotificationType = async (type) => {
    const isCurrentlyOn = prefs[type] !== false;
    const newPrefs = { ...prefs, [type]: !isCurrentlyOn };
    setPrefs(newPrefs); // optimistic
    setPrefsSaving(true);
    try {
      const { error } = await supabase.from('profiles').update({ notification_prefs: newPrefs }).eq('id', user.uid);
      if (error) throw error;
      onNotificationPrefsChange?.(newPrefs);
    } catch (err) {
      console.warn('[SettingsPanel] Could not save notification prefs:', err.message);
      setPrefs(prefs); // revert optimistic update on failure
    }
    setPrefsSaving(false);
  };

  // NEW (CHANGE 018): personal stake limit. Local state seeded from the
  // user prop; empty string means "no limit set" in the input (distinct
  // from "0", which isn't a valid limit anyway per the schema CHECK).
  const [stakeLimitInput, setStakeLimitInput] = useState(user.max_stake_limit != null ? String(user.max_stake_limit) : "");
  const [stakeLimitErr,   setStakeLimitErr]   = useState("");
  const [stakeLimitMsg,   setStakeLimitMsg]   = useState("");
  const [stakeLimitSaving, setStakeLimitSaving] = useState(false);

  const saveStakeLimit = async () => {
    setStakeLimitErr(""); setStakeLimitMsg("");
    const trimmed = stakeLimitInput.trim();
    // Empty input clears the limit entirely (back to platform default).
    let newLimit = null;
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0)     return setStakeLimitErr("Enter a positive amount, or leave blank to remove your limit.");
      if (n > MAX_STAKE)                     return setStakeLimitErr(`Your limit can't exceed the platform maximum of ${fmt(MAX_STAKE)}.`);
      newLimit = n;
    }
    setStakeLimitSaving(true);
    try {
      const { error } = await supabase.from('profiles').update({ max_stake_limit: newLimit }).eq('id', user.uid);
      if (error) throw error;
      onMaxStakeChange?.(newLimit);
      setStakeLimitMsg(newLimit != null ? `Stake limit set to ${fmt(newLimit)}.` : "Stake limit removed — platform default applies.");
    } catch (err) {
      setStakeLimitErr("Could not save: " + err.message);
    }
    setStakeLimitSaving(false);
  };

  // NEW (CHANGE 019): admin-only odds margins. Self-contained — unlike
  // notification_prefs/max_stake_limit, nothing else in the current
  // session needs to react live to this; AdminMatches fetches
  // platform_settings fresh every time it mounts, so no App-root
  // callback wiring is needed here.
  const [margins,        setMargins]        = useState(null);
  const [marginsLoading, setMarginsLoading]  = useState(true);
  const [marginsErr,     setMarginsErr]      = useState("");
  const [marginsMsg,     setMarginsMsg]      = useState("");
  const [marginsSaving,  setMarginsSaving]   = useState(false);

  useEffect(() => {
    if (user.role !== "admin") { setMarginsLoading(false); return; }
    (async () => {
      try {
        const { data, error } = await supabase.from('platform_settings').select('odds_margins').eq('id', true).single();
        if (error) throw error;
        setMargins(data?.odds_margins || {});
      } catch (err) {
        setMarginsErr("Could not load margin settings: " + err.message);
      }
      setMarginsLoading(false);
    })();
  }, [user.role]);

  const saveMargins = async () => {
    setMarginsErr(""); setMarginsMsg("");
    // Every margin must be a real bookmaker overround (>1.00, i.e. house
    // edge exists) and sane (capped at 3.00 — a 200% margin is already
    // absurd for any real market).
    for (const { key, label } of MARGIN_FIELDS) {
      const v = Number(margins[key]);
      if (!Number.isFinite(v) || v < 1.01 || v > 3.0) {
        return setMarginsErr(`${label}: enter a value between 1.01 and 3.00.`);
      }
    }
    setMarginsSaving(true);
    try {
      const cleaned = Object.fromEntries(MARGIN_FIELDS.map(({ key }) => [key, Number(margins[key])]));
      const { error } = await supabase.from('platform_settings').update({ odds_margins: cleaned }).eq('id', true);
      if (error) throw error;
      setMargins(cleaned);
      setMarginsMsg("Saved — applies to fixtures created or re-Computed from now on, never to odds already posted.");
    } catch (err) {
      setMarginsErr("Could not save: " + err.message);
    }
    setMarginsSaving(false);
  };

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>Settings</h2>
        <p style={{ color: C.muted, margin: "4px 0 0", fontSize: 13 }}>Manage your account security.</p>
      </div>

      <div style={{ ...styles.card, maxWidth: 440 }}>
        <h3 style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 16 }}>Change Password</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={styles.label}>Current Password</label>
            <input style={styles.input} type={showPass ? "text" : "password"}
              value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <label style={styles.label}>New Password</label>
            <input style={styles.input} type={showPass ? "text" : "password"}
              value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div>
            <label style={styles.label}>Confirm New Password</label>
            <input style={styles.input} type={showPass ? "text" : "password"}
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted, cursor: "pointer" }}>
            <input type="checkbox" checked={showPass} onChange={e => setShowPass(e.target.checked)} />
            Show passwords
          </label>

          {err && <div style={{ color: C.red, fontSize: 12, background: C.red + "15", borderRadius: 6, padding: "8px 12px" }}>{err}</div>}
          {msg && <div style={{ color: C.win, fontSize: 12, background: C.win + "15", borderRadius: 6, padding: "8px 12px" }}>{msg}</div>}

          <button style={{ ...styles.btn("primary"), padding: "12px 0" }} onClick={handleChangePassword} disabled={loading}>
            {loading ? "…" : "Update Password"}
          </button>
        </div>
      </div>

      {/* NEW (CHANGE 019): admin-only bookmaker margin config. Replaces
          the previously-hardcoded literals scattered through suggestOdds. */}
      {user.role === "admin" && (
        <div style={{ ...styles.card, maxWidth: 440, marginTop: 16 }}>
          <h3 style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 16 }}>Odds Margins</h3>
          <p style={{ color: C.muted, fontSize: 12, margin: "0 0 16px" }}>
            Bookmaker overround per market, e.g. 1.05 = 5% margin. Applies to fixtures created or
            re-Computed from now on — never rewrites odds already posted or already bet on.
          </p>
          {marginsLoading ? (
            <div style={{ color: C.muted, fontSize: 13 }}>Loading…</div>
          ) : !margins ? (
            <div style={{ color: C.red, fontSize: 13 }}>{marginsErr || "Could not load margin settings."}</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                {MARGIN_FIELDS.map(({ key, label }) => (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: C.text }}>{label}</span>
                    <input style={{ ...styles.input, width: 90, padding: "6px 10px", textAlign: "right" }}
                      type="number" step="0.01" min="1.01" max="3.00"
                      value={margins[key] ?? ""} onChange={e => setMargins(m => ({ ...m, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              {marginsErr && <div style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{marginsErr}</div>}
              {marginsMsg && <div style={{ color: C.win, fontSize: 12, marginBottom: 10 }}>{marginsMsg}</div>}
              <button style={{ ...styles.btn("primary"), width: "100%", padding: "10px 0", opacity: marginsSaving ? 0.6 : 1 }}
                onClick={saveMargins} disabled={marginsSaving}>
                {marginsSaving ? "…" : "Save Margins"}
              </button>
            </>
          )}
        </div>
      )}

      {/* NEW (CHANGE 017): bettor-only — admin's only current notification
          type (wallet_request_pending) isn't mutable, so there's nothing
          to show an admin here yet. */}
      {user.role === "bettor" && (
        <div style={{ ...styles.card, maxWidth: 440, marginTop: 16 }}>
          <h3 style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 16 }}>Notification Preferences</h3>
          <p style={{ color: C.muted, fontSize: 12, margin: "0 0 16px" }}>
            Choose which events send you a notification. Muted events still happen — you just won't be alerted.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {MUTABLE_NOTIFICATION_TYPES.map(({ type, label }) => {
              const isOn = prefs[type] !== false;
              return (
                <label key={type} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: prefsSaving ? "default" : "pointer" }}>
                  <span style={{ fontSize: 13, color: C.text }}>{label}</span>
                  <input type="checkbox" checked={isOn} disabled={prefsSaving}
                    onChange={() => toggleNotificationType(type)} />
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* NEW (CHANGE 018): bettor-only stake limit. No self-exclusion, no
          cooldown-on-increase mechanic — kept deliberately simple per
          user's explicit request ("just do a stake limit"). */}
      {user.role === "bettor" && (
        <div style={{ ...styles.card, maxWidth: 440, marginTop: 16 }}>
          <h3 style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 16 }}>Stake Limit</h3>
          <p style={{ color: C.muted, fontSize: 12, margin: "0 0 16px" }}>
            Set your own maximum bet size, below the platform limit of {fmt(MAX_STAKE)}. Leave blank to remove it.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <input style={styles.input} type="number" min="1" max={MAX_STAKE}
                placeholder={`No limit set (platform max: ${fmt(MAX_STAKE)})`}
                value={stakeLimitInput} onChange={e => setStakeLimitInput(e.target.value)} />
            </div>
            <button style={{ ...styles.btn("primary", "sm"), opacity: stakeLimitSaving ? 0.6 : 1 }}
              onClick={saveStakeLimit} disabled={stakeLimitSaving}>
              {stakeLimitSaving ? "…" : "Save"}
            </button>
          </div>
          {stakeLimitErr && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{stakeLimitErr}</div>}
          {stakeLimitMsg && <div style={{ color: C.win, fontSize: 12, marginTop: 8 }}>{stakeLimitMsg}</div>}
        </div>
      )}

      {/* SET-3 placeholder — a visible, honest "not yet" instead of silently
          omitting it, so it's clear this was a deliberate pause, not a miss. */}
      <div style={{ ...styles.card, maxWidth: 440, marginTop: 16, opacity: 0.6 }}>
        <h3 style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 16 }}>Appearance</h3>
        <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Dark / light mode toggle — coming soon.</p>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser,    setCurrentUser]    = useState(null);
  const [tab,            setTab]            = useState("");
  const [slipSelections, setSlipSelections] = useState([]);

  // NEW (CHANGE 014): live odds-change detection for the betslip — the
  // "odds moved, accept or void that leg" flow. Only meaningful for
  // bettors with something in their slip, so the subscription only runs
  // then. Compares the specific outcome each slip item is pinned to
  // against the live update; a change anywhere else in that match's odds
  // blob (a different market) doesn't flag anything, since it doesn't
  // affect what's actually in the slip.
  useEffect(() => {
    if (!currentUser || currentUser.role !== "bettor" || slipSelections.length === 0) return;
    const channel = supabase
      .channel('betslip-odds-watch')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, (payload) => {
        const updated = payload.new;
        setSlipSelections(prev => prev.map(item => {
          if (item.match.id !== updated.id || item.stale) return item; // already flagged, don't re-flag
          const newOdds = updated.odds || {};
          const oldOddsForOutcome = item.match.odds?.[item.outcome];
          const newOddsForOutcome = newOdds[item.outcome];
          if (oldOddsForOutcome == null || newOddsForOutcome == null || oldOddsForOutcome === newOddsForOutcome) {
            return item; // no change to the specific outcome this leg is pinned to
          }
          return {
            ...item,
            stale: {
              oldOdds: oldOddsForOutcome,
              newOdds: newOddsForOutcome,
              // Fresh match snapshot to swap in if the bettor accepts —
              // only the fields the betslip actually reads (homeTeam/
              // awayTeam/odds), not a full re-map of every column.
              freshMatch: { ...item.match, homeTeam: updated.home_team, awayTeam: updated.away_team, odds: newOdds },
            },
          };
        }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser?.role, slipSelections.length]);

  // NEW (CHANGE 014): resolves a stale leg by accepting the new odds —
  // swaps in the fresh match snapshot captured at flag-time and clears
  // the stale marker. Rejecting just reuses the existing onRemove path
  // already wired to BetslipBasket, no new function needed for that side.
  const handleAcceptOddsChange = (matchId, outcome) => {
    setSlipSelections(prev => prev.map(item =>
      item.match.id === matchId && item.outcome === outcome && item.stale
        ? { match: item.stale.freshMatch, outcome: item.outcome }
        : item
    ));
  };

  // ITEM 25: was keyed on the whole `currentUser` object by reference — item
  // 21's 15s self-profile poll replaces currentUser with a new object every
  // cycle (spread creates a new reference even when values are identical),
  // which retriggered this effect and force-navigated the admin back to
  // "Dashboard" every 15 seconds regardless of what tab/view they were
  // actually on (e.g. mid-settlement in AdminMatches). Keying on role alone
  // means this only fires on an actual login or a genuine role change, not
  // on every balance/name refresh.
  useEffect(() => {
    if (currentUser) setTab(currentUser.role === "admin" ? "Dashboard" : "Match Board");
  }, [currentUser?.role]);

  // ITEM 20: Supabase's JS client persists the auth session in localStorage,
  // which is shared across every tab of the same browser origin — not
  // per-tab. Before this listener, `currentUser` was only ever set once, on
  // manual login (handleLogin below). If a second tab in the same browser
  // signed in as a different user, Supabase's client would silently swap
  // the active session (it listens for the storage event across tabs), but
  // this tab's React state never found out — so the UI kept showing the old
  // user while every RPC call was actually being sent with the new session's
  // token. That's exactly what produced item 16b's confusing "Admin access
  // required" error while the screen still looked like the admin was signed
  // in. This subscription makes that drift visible/corrected instead of
  // silent: any time the real session changes to a different user (or a
  // persisted session is found on load — INITIAL_SESSION — or the session
  // ends), currentUser is refetched/cleared to match reality.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setCurrentUser(null);
        return;
      }
      setCurrentUser(prev => {
        // Same user, e.g. a token refresh — nothing to do, avoid a
        // redundant profile fetch on every silent token renewal.
        if (prev && prev.uid === session.user.id) return prev;

        // Different (or first-seen) session for this tab. Fetch the real
        // profile async and correct currentUser once it resolves — this
        // is deliberately allowed to run redundantly alongside
        // AuthScreen's own post-login fetch (handleLogin below); both
        // read the same row, so a harmless duplicate fetch at most, never
        // a conflict.
        supabase.from('profiles').select('*').eq('id', session.user.id).single()
          .then(({ data: profile, error }) => {
            if (error || !profile) {
              // Real auth session but no matching profiles row — same
              // orphaned-user situation as item 12. Signing out here is
              // safer than showing a half-populated user object.
              console.warn('[App.onAuthStateChange] session exists but no matching profile:', error?.message);
              setCurrentUser(null);
              return;
            }
            setCurrentUser({
              uid:       profile.id,
              email:     profile.email,
              name:      profile.username,
              role:      profile.role,
              balance:   Number(profile.balance),
              notification_prefs: profile.notification_prefs || {},
              max_stake_limit: profile.max_stake_limit,
              createdAt: new Date(profile.created_at).getTime(),
            });
          });

        // Keep showing whatever was there (likely null, pre-login) until
        // the async fetch above resolves.
        return prev;
      });
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin  = (user) => setCurrentUser(user);
  const handleLogout = ()     => { setCurrentUser(null); setSlipSelections([]); };

  // Always read fresh user data from DB so balance changes propagate without
  // requiring a full re-login.
  // ITEM 21 (migration doc #7): previously read getDB().users[currentUser.uid]
  // from localStorage on every render — dead code since balance changes moved
  // to Supabase; localStorage's users object is never written to for a real
  // account anymore. currentUser itself is now kept fresh by the polling
  // effect just below, so this simply returns it.
  const getFreshUser = () => currentUser;
  const activeUser = getFreshUser();

  // ITEM 21: keeps the signed-in user's own profile (balance, role, name) in
  // sync with Supabase every 15s, independent of any action THIS tab takes —
  // this is what catches an admin approving a deposit/withdrawal from a
  // different session, which nothing in this tab would otherwise ever learn
  // about. Same 15s cadence as AdminWallets/BettorWallet for consistency.
  useEffect(() => {
    if (!currentUser?.uid) return;
    const refreshProfile = async () => {
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', currentUser.uid)
          .single();
        if (error || !profile) return; // stay on last-known-good state, don't clobber on a transient failure
        setCurrentUser(prev => (prev ? {
          ...prev,
          name:    profile.username,
          role:    profile.role,
          balance: Number(profile.balance),
          notification_prefs: profile.notification_prefs || {},
          max_stake_limit: profile.max_stake_limit,
        } : prev));
      } catch (err) {
        console.warn('[App.refreshProfile] Supabase unavailable:', err.message);
      }
    };
    refreshProfile();
    const interval = setInterval(refreshProfile, 15000);
    return () => clearInterval(interval);
  }, [currentUser?.uid]);

  // NEW: cash-out handler — marks the bet settled early, credits the cash-out
  // value to the bettor's wallet, and returns true so BettorMyBets can reload.
  // Uses "cashedout" as a distinct status from "voided" so bet history can
  // clearly show a deliberate early cash-out vs a cancelled-match refund.
  // WIRED (Session 8, item 8) — cash_out_bet genuinely exists in the new
  // live schema (confirmed from the deployed function body the user pasted).
  // Signature is just `cash_out_bet(p_bet_id UUID)` — no p_user_id, no
  // p_cash_out_value. The server identifies the caller via auth.uid(),
  // locks the bet row, counts won/total legs itself, and computes the
  // cash-out value with its OWN formula (same Option A logic BettorMyBets's
  // calcCashOut already mirrors: 85% of stake / 90% of potential payout /
  // weighted 0.75 for partial progress). So the client's cashOutValue is
  // only ever a preview now — the server's returned value is authoritative,
  // and that's what gets added to the balance. The RPC returns
  // {success, cash_out_value} but NOT a new_balance, so the new balance is
  // computed here from the known current balance + the authoritative
  // cash_out_value, rather than doing a second round-trip just to read it
  // back.
  const handleCashOut = async (betId, cashOutValue) => {
    try {
      const { data, error } = await supabase.rpc('cash_out_bet', { p_bet_id: betId });
      if (error) throw error;
      if (!data?.success) return false;
      setCurrentUser({ ...currentUser, balance: +(currentUser.balance + data.cash_out_value).toFixed(2) });
      return true;
    } catch (err) {
      console.warn('[handleCashOut] Supabase unavailable, using localStorage:', err.message);
    }

    // ── LOCALSTORAGE FALLBACK — identical to the original implementation ──
    const db   = getDB();
    const acct = db.users[currentUser.uid];
    if (!acct) return false;

    db.bets = (db.bets || []).map(b => {
      if (b.id !== betId || b.status !== "active") return b;
      acct.balance = +(acct.balance + cashOutValue).toFixed(2);
      return { ...b, status: "cashedout", payout: cashOutValue };
    });

    saveDB(db);
    setCurrentUser({ ...acct });
    return true;
  };

  // Toggle a market selection into / out of the betslip.
  // Same-match different-outcome: replace existing entry for that match.
  const handleToggleSlipSelection = (match, outcome) => {
    setSlipSelections(prev => {
      // FIX: key on match.id + outcome compound key, not match.id alone.
      // Old behaviour: one slot per match — a second market on the same match
      // replaced the first pick (swap). New behaviour: one slot per outcome
      // per match — clicking a different market adds a new leg, clicking the
      // same cell again removes it (true Same Game Multi / SGM support).
      const existingIndex = prev.findIndex(
        i => i.match.id === match.id && i.outcome === outcome
      );
      if (existingIndex !== -1) {
        // Same cell clicked again — deselect (remove this specific leg)
        return prev.filter((_, idx) => idx !== existingIndex);
      }
      // New market on same match OR new match entirely — add as new leg
      return [...prev, { match, outcome }];
    });
  };

  const handleConfirmMultiBet = async (stake, combinedOdds) => {
    // Verify every *unique* match in the slip is still open AND kickoff hasn't
    // passed. FIX: with SGM, the same match can appear multiple times (different
    // markets) so deduplicate by matchId first to avoid duplicate error messages.
    // This client-side check stays as a fast pre-flight UX check (instant error
    // message without a round-trip) — the RPC re-validates everything server-side
    // regardless, so this check is a courtesy, not the actual security boundary.
    const uniqueMatchIds = [...new Set(slipSelections.map(s => s.match.id))];
    const now = Date.now();
    for (const matchId of uniqueMatchIds) {
      const sel = slipSelections.find(s => s.match.id === matchId);
      const dbMatch = (getDB().matches || []).find(m => m.id === matchId);
      if (dbMatch) {
        if (dbMatch.status !== "open") { // REVERTED: was "scheduled" — new live schema's place_bet checks status = 'open'
          return { success: false, msg: `Market closed: ${sel.match.homeTeam} vs ${sel.match.awayTeam}` };
        }
        if (dbMatch.kickoff && now >= dbMatch.kickoff) {
          return { success: false, msg: `Match already kicked off: ${sel.match.homeTeam} vs ${sel.match.awayTeam}` };
        }
      }
    }

    // Detect SGM: any match appearing more than once across the selections
    const matchIdCounts = slipSelections.reduce((acc, s) => {
      acc[s.match.id] = (acc[s.match.id] || 0) + 1;
      return acc;
    }, {});
    const isSGM = Object.values(matchIdCounts).some(count => count > 1);
    const betType = isSGM ? "sgm" : slipSelections.length > 1 ? "accumulator" : "single";

    // Build the legs array in the exact shape place_bet expects.
    const legs = slipSelections.map(s => {
      const outcome   = s.outcome;
      const marketType = deriveMarketType(outcome);
      // Extract the "line" value needed for server-side grading.
      // HANDICAP: e.g. "handicap_main_home" splits to ["handicap","main","home"];
      // slot = "main", look up the line value from the match's stored
      // _handicapLines map (unchanged, this part already worked).
      // NEW (item 10): TOTAL_GOALS also needs a line value now — the new live
      // schema's settle_match_and_payouts reuses this same handicap_line
      // column as a generic "line" for over/under comparison
      // (`v_total_goals > v_leg.handicap_line`). Nothing ever populated this
      // for total-goals legs before, since the old live schema never graded
      // TOTAL_GOALS at all — it would have silently compared against NULL
      // and never graded correctly. Outcome keys are either "total_over"/
      // "total_under" (the base 2.5 line, no numeric prefix) or
      // "total_1_5_over"/"total_3_5_over" (alt lines, parsed directly from
      // the key) — falls back to the match's stored base 2.5 line if for
      // some reason it's not in the key.
      let handicapLine = null;
      if (marketType === "HANDICAP") {
        const slot = outcome.split("_")[1];
        handicapLine = s.match.odds?._handicapLines?.[slot] ?? null;
      } else if (marketType === "TOTAL_GOALS") {
        const altLineMatch = outcome.match(/^total_(\d+)_(\d+)_(over|under)$/);
        handicapLine = altLineMatch
          ? Number(`${altLineMatch[1]}.${altLineMatch[2]}`)
          : (s.match.odds?._totalGoalsLines?.["2.5"]?.line ?? 2.5);
      }
      return {
        match_id:           s.match.id,
        market_type:        marketType,
        selection:          outcome,
        odds_at_placement:  s.match.odds?.[outcome] || 1,
        handicap_line:      handicapLine,
      };
    });

    const potentialPayout = +(stake * combinedOdds).toFixed(2);

    // REVERTED (Session 8) — new live schema's place_bet signature includes
    // p_is_sgm (p_user_id, p_type, p_is_sgm, p_stake, p_total_odds,
    // p_potential_payout, p_legs) — confirmed from the deployed function
    // body pasted by the user. Restoring it.
    try {
      const { data, error } = await supabase.rpc('place_bet', {
        p_user_id:           currentUser.uid,
        p_type:              betType,
        p_is_sgm:            isSGM,
        p_stake:             stake,
        p_total_odds:        combinedOdds,
        p_potential_payout:  potentialPayout,
        p_legs:              legs,
      });

      if (error) throw error;
      if (!data?.success) return { success: false, msg: data?.message || "Bet could not be placed." };

      // Sync currentUser balance from the RPC's authoritative new_balance
      setCurrentUser({ ...currentUser, balance: data.new_balance });
      return { success: true };

    } catch (err) {
      // Supabase unavailable — fall back to the original localStorage logic
      // so betting doesn't break entirely during the migration window.
      console.warn('[handleConfirmMultiBet] Supabase unavailable, using localStorage:', err.message);

      const db   = getDB();
      const acct = db.users[currentUser.uid];
      if (!acct || acct.balance < stake) return { success: false, msg: "Insufficient balance." };

      acct.balance = +(acct.balance - stake).toFixed(2);
      const bet = {
        id:         "bet_" + Date.now(),
        userId:     currentUser.uid,
        odds:       combinedOdds,
        stake:      stake,
        status:     "active",
        isSGM,
        selections: slipSelections.map(s => ({
          matchId: s.match.id,
          outcome: s.outcome,
          odds:    s.match.odds?.[s.outcome] || 1,
        })),
        createdAt: Date.now(),
      };

      db.bets = [...(db.bets || []), bet];
      saveDB(db);
      setCurrentUser({ ...acct });
      return { success: true };
    }
  };

  // NEW (CHANGE 017): local update after SettingsPanel writes new
  // notification_prefs to Supabase — keeps NotificationBell's filtering
  // current immediately rather than waiting up to 15s for the next
  // refreshProfile poll.
  const handleNotificationPrefsChange = (newPrefs) => {
    setCurrentUser(prev => (prev ? { ...prev, notification_prefs: newPrefs } : prev));
  };

  // NEW (CHANGE 018): local update after SettingsPanel writes a new
  // max_stake_limit — same pattern as notification prefs, keeps the
  // betslip's effective cap current immediately.
  const handleMaxStakeChange = (newLimit) => {
    setCurrentUser(prev => (prev ? { ...prev, max_stake_limit: newLimit } : prev));
  };

  const activeSlipKeys = slipSelections.map(s => `${s.match.id}-${s.outcome}`);

  if (!currentUser) return <AuthScreen onLogin={handleLogin} />;

  return (
    <AuthCtx.Provider value={{ user: activeUser }}>
      <div style={styles.app}>
        {/* UI POLISH: global pseudo-class styles injected once at the app root.
            React inline styles can't express :focus, :hover, or :active pseudo-
            classes, so these are handled here. All selectors are scoped to avoid
            interfering with anything outside the app root.
            Changes: input focus ring, button hover lift, dark scrollbars. */}
        <style>{`
          input:focus-visible, textarea:focus-visible {
            border-color: #c8313f !important;
            box-shadow: 0 0 0 2px rgba(200,49,63,0.2) !important;
           
          }
          button:hover { opacity: 0.88; }
          button:active { transform: scale(0.97); }
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: #0a0f1e; }
          ::-webkit-scrollbar-thumb { background: #1e2d45; border-radius: 3px; }
          ::-webkit-scrollbar-thumb:hover { background: #2a3b5c; }
        `}</style>
        <Navbar user={activeUser} onLogout={handleLogout} tab={tab} setTab={setTab} />

        {activeUser.role === "admin" ? (
          <>
            {tab === "Dashboard"       && <AdminDashboard user={activeUser} setTab={setTab} />}
            {tab === "Matches"         && <AdminMatches />}
            {tab === "Team Stats"      && <AdminTeamStats />}
            {tab === "Users"           && <AdminUsers />}
            {tab === "Wallets Balance" && <AdminWallets />}
            {tab == "Settings"         && <SettingsPanel user={activeUser} onNotificationPrefsChange={handleNotificationPrefsChange} onMaxStakeChange={handleMaxStakeChange} />}
          </>
        ) : (
          <>
            {tab === "Match Board"      && <BettorBoard user={activeUser} onAddSelection={handleToggleSlipSelection} activeSlipKeys={activeSlipKeys} />}
            {tab === "My Bets"          && <BettorMyBets user={activeUser} onCashOut={handleCashOut} />}
            {tab === "Wallet Dashboard" && <BettorWallet user={activeUser} />}
            {tab === "Settings"         && <SettingsPanel user={activeUser} onNotificationPrefsChange={handleNotificationPrefsChange} onMaxStakeChange={handleMaxStakeChange} />}
            <BetslipBasket
              selections={slipSelections}
              onRemove={(mId, outc) => setSlipSelections(p => p.filter(x => !(x.match.id === mId && x.outcome === outc)))}
              onClear={() => setSlipSelections([])}
              userBalance={activeUser.balance}
              onConfirmBets={handleConfirmMultiBet}
              onAcceptOddsChange={handleAcceptOddsChange}
              maxStakeLimit={activeUser.max_stake_limit}
            />
          </>
        )}
      </div>
    </AuthCtx.Provider>
  );
}