import { useEffect, useState } from "react";
import { getSteamProfiles } from "../api/client";
import type { Encounter, Profile, Totals } from "../api/native";
import type { SteamProfile } from "../api/types";
import type { HeroMap } from "../hooks/useHeroes";
import { useProfile } from "../hooks/useProfile";
import { formatPercent, formatRelativeTime, formatSouls } from "../lib/format";
import { totalsKda, totalsWinRate } from "../lib/stats";
import { HeroBadge } from "./HeroBadge";
import { MatchTable } from "./MatchTable";
import { Stat } from "./Stat";

/** Your profile, and anyone you've played with, from the local database. */
export function ProfilePage({ selfId, heroes }: { selfId: number; heroes: HeroMap }) {
  // Players opened from the encounters list, so Back can retrace them.
  const [trail, setTrail] = useState<number[]>([]);
  useEffect(() => setTrail([]), [selfId]);
  const accountId = trail.at(-1) ?? selfId;

  return (
    <ProfileView
      key={accountId}
      accountId={accountId}
      isSelf={accountId === selfId}
      heroes={heroes}
      onOpen={(id) => setTrail((t) => (id === selfId ? [] : [...t, id]))}
      onBack={trail.length > 0 ? () => setTrail((t) => t.slice(0, -1)) : undefined}
    />
  );
}

interface ViewProps {
  accountId: number;
  isSelf: boolean;
  heroes: HeroMap;
  onOpen: (accountId: number) => void;
  onBack?: () => void;
}

function ProfileView({ accountId, isSelf, heroes, onOpen, onBack }: ViewProps) {
  const { profile, error, refreshError } = useProfile(accountId);
  const steam = useSteamProfile(accountId);

  return (
    <>
      <section className="panel panel--wide">
        <header className="panel__header">
          <div className="profile-title">
            {onBack && (
              <button className="button" onClick={onBack}>
                ← Back
              </button>
            )}
            {steam?.avatarmedium && <img className="profile-title__avatar" src={steam.avatarmedium} alt="" />}
            <h2>{steam?.personaname ?? profile?.player.persona_name ?? `Player ${accountId}`}</h2>
            <span className="muted">#{accountId}</span>
          </div>
          {profile?.player.first_seen_at != null && (
            <span className="muted">First seen {formatRelativeTime(profile.player.first_seen_at)}</span>
          )}
        </header>
        {error && <p className="error">Couldn't read saved data: {error}</p>}
        {refreshError && <p className="muted">Couldn't update from deadlock-api, showing saved data: {refreshError}</p>}
        {!profile && !error && <p className="muted">Loading…</p>}
        {profile && <Summary totals={profile.totals} />}
      </section>

      {profile && profile.totals.matches > 0 && (
        <>
          <HeroesPanel profile={profile} heroes={heroes} />
          <EncountersPanel encounters={profile.encounters} isSelf={isSelf} onOpen={onOpen} />
          <section className="panel panel--wide">
            <header className="panel__header">
              <h2>Matches</h2>
              <span className="muted">
                Latest {profile.matches.length} of {profile.totals.matches} saved
              </span>
            </header>
            <MatchTable matches={profile.matches} heroes={heroes} />
          </section>
        </>
      )}
    </>
  );
}

function Summary({ totals }: { totals: Totals }) {
  if (totals.matches === 0) {
    return <p className="muted">No matches saved for this player yet.</p>;
  }
  return (
    <div className="match-header">
      <Stat label="Matches" value={String(totals.matches)} />
      <Stat label="Record" value={`${totals.wins}–${totals.losses}`} />
      <Stat label="Win rate" value={formatPercent(totalsWinRate(totals))} />
      <Stat label="KDA" value={totalsKda(totals)?.toFixed(2) ?? "–"} />
      <Stat label="Avg souls" value={totals.avg_net_worth != null ? formatSouls(Math.round(totals.avg_net_worth)) : "–"} />
      <Stat label="Time played" value={`${(totals.seconds_played / 3600).toFixed(1)} h`} />
    </div>
  );
}

function HeroesPanel({ profile, heroes }: { profile: Profile; heroes: HeroMap }) {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Heroes</h2>
      </header>
      {profile.heroes.length === 0 ? (
        <p className="muted">No hero data yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Hero</th>
              <th className="num">Matches</th>
              <th className="num">W–L</th>
              <th className="num">Win rate</th>
              <th className="num">KDA</th>
              <th className="num">Avg souls</th>
            </tr>
          </thead>
          <tbody>
            {profile.heroes.map((h) => (
              <tr key={h.hero_id}>
                <td>
                  <HeroBadge heroId={h.hero_id} heroes={heroes} />
                </td>
                <td className="num">{h.matches}</td>
                <td className="num">
                  {h.wins}–{h.losses}
                </td>
                <td className="num">{formatPercent(totalsWinRate(h))}</td>
                <td className="num">{totalsKda(h)?.toFixed(1) ?? "–"}</td>
                <td className="num">{h.avg_net_worth != null ? formatSouls(Math.round(h.avg_net_worth)) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EncountersPanel({
  encounters,
  isSelf,
  onOpen,
}: {
  encounters: Encounter[];
  isSelf: boolean;
  onOpen: (accountId: number) => void;
}) {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2>{isSelf ? "Players you've met" : "Players seen with them"}</h2>
        <span className="muted">Win–loss from {isSelf ? "your" : "their"} side</span>
      </header>
      {encounters.length === 0 ? (
        <p className="muted">
          Nobody yet. Other players are saved from the live scoreboard, so they show up once you've played a match with
          the app open.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">Matches</th>
              <th className="num">With</th>
              <th className="num">Against</th>
              <th className="num">Last</th>
            </tr>
          </thead>
          <tbody>
            {encounters.map((e) => (
              <tr key={e.account_id}>
                <td>
                  <button className="link" onClick={() => onOpen(e.account_id)}>
                    {e.persona_name ?? `Player ${e.account_id}`}
                  </button>
                </td>
                <td className="num">{e.matches}</td>
                <td className="num">{e.with_matches ? `${e.with_wins}–${e.with_losses}` : "–"}</td>
                <td className="num">{e.against_matches ? `${e.against_wins}–${e.against_losses}` : "–"}</td>
                <td className="num muted">{e.last_played != null ? formatRelativeTime(e.last_played) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function useSteamProfile(accountId: number): SteamProfile | null {
  const [profile, setProfile] = useState<SteamProfile | null>(null);
  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    getSteamProfiles([accountId])
      .then((list) => !cancelled && setProfile(list[0] ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  return profile;
}
