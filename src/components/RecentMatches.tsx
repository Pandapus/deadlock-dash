import type { HeroMap } from "../hooks/useHeroes";
import { useProfile } from "../hooks/useProfile";
import { formatPercent } from "../lib/format";
import { totalsKda, totalsWinRate } from "../lib/stats";
import { MatchTable } from "./MatchTable";

const SHOWN = 15;

export function RecentMatches({ accountId, heroes }: { accountId: number; heroes: HeroMap }) {
  const { profile, error, refreshError } = useProfile(accountId, SHOWN);
  const totals = profile?.totals;

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Recent matches</h2>
        {totals && totals.matches > 0 && (
          <span className="muted">
            {totals.matches} saved · {formatPercent(totalsWinRate(totals))} win rate · {totalsKda(totals)?.toFixed(1) ?? "–"}{" "}
            KDA
          </span>
        )}
      </header>
      {error && <p className="error">Couldn't read saved matches: {error}</p>}
      {refreshError && <p className="muted">Couldn't update from deadlock-api, showing saved matches: {refreshError}</p>}
      {!profile && !error && <p className="muted">Loading…</p>}
      {profile && profile.matches.length === 0 && (
        <p className="muted">
          No matches yet. They're saved as you play with the app open, and from deadlock-api, which only has full
          history for accounts it has seen (see the README).
        </p>
      )}
      {profile && profile.matches.length > 0 && <MatchTable matches={profile.matches} heroes={heroes} />}
    </section>
  );
}
