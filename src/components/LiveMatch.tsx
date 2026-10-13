import { useEffect, useRef, useState } from "react";
import { getActiveMatches, getMatchHistory, getSteamProfiles } from "../api/client";
import type { ActiveMatch, ActiveMatchPlayer, MatchHistoryEntry } from "../api/types";
import type { GameState } from "../hooks/useConsoleWatch";
import type { HeroMap } from "../hooks/useHeroes";
import { formatDuration, formatPercent, formatSignedSouls, formatSouls } from "../lib/format";
import { heroRecord, summarize } from "../lib/stats";
import { HeroBadge } from "./HeroBadge";
import { NetWorthChart, type NetWorthSample } from "./NetWorthChart";
import { Stat } from "./Stat";
import { sidesClass, TEAM_BY_INDEX } from "../lib/teams";

/** deadlock-api caches the active match list for 60s. */
const POLL_MS = 60_000;

interface Props {
  accountId: number;
  heroes: HeroMap;
  game: GameState;
}

export function LiveMatch({ accountId, heroes, game }: Props) {
  const [match, setMatch] = useState<ActiveMatch | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const samplesRef = useRef(new Map<number, NetWorthSample[]>());
  const [, forceRender] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const matches = await getActiveMatches([accountId]);
        if (cancelled) return;
        const mine = matches.find((m) => m.players.some((p) => p.account_id === accountId)) ?? null;
        setMatch(mine);
        setError(null);
        if (mine) recordSample(samplesRef.current, mine, accountId);
        forceRender((n) => n + 1);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setCheckedAt(new Date());
      }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Re-poll right away when the console log says we entered or left a game.
  }, [accountId, game.phase]);

  const myTeam = match?.players.find((p) => p.account_id === accountId)?.team ?? null;
  const samples = match?.match_id != null ? samplesRef.current.get(match.match_id) ?? [] : [];

  return (
    <section className={`panel panel--wide ${sidesClass(TEAM_BY_INDEX[myTeam ?? 1])}`}>
      <header className="panel__header">
        <h2>Live match</h2>
        <span className="muted">
          {checkedAt ? `Checked ${checkedAt.toLocaleTimeString()}` : "Checking…"} · public feed runs ~1–2 min behind
        </span>
      </header>
      {error && <p className="error">Couldn't load active matches: {error}</p>}
      {!match && !error && <NotInFeed game={game} />}
      {match && myTeam !== null && (
        <>
          <MatchHeader match={match} myTeam={myTeam} />
          <NetWorthChart samples={samples} />
          <Teams match={match} myTeam={myTeam} heroes={heroes} />
        </>
      )}
    </section>
  );
}

function recordSample(store: Map<number, NetWorthSample[]>, match: ActiveMatch, accountId: number) {
  const team = match.players.find((p) => p.account_id === accountId)?.team;
  if (match.match_id == null || match.duration_s == null || team == null) return;
  const [mine, theirs] =
    team === 0 ? [match.net_worth_team_0, match.net_worth_team_1] : [match.net_worth_team_1, match.net_worth_team_0];
  if (mine == null || theirs == null) return;
  const samples = store.get(match.match_id) ?? [];
  if (samples.at(-1)?.t !== match.duration_s) samples.push({ t: match.duration_s, diff: mine - theirs });
  store.set(match.match_id, samples);
}

function NotInFeed({ game }: { game: GameState }) {
  return (
    <div className="empty">
      {game.phase === "in_game" ? (
        <p>
          The console log says you're in a game{game.map ? ` on ${game.map}` : ""}
          {game.matchId ? ` (match ${game.matchId})` : ""}, but it isn't in the public feed.
        </p>
      ) : (
        <p>You're not in a match the public feed knows about.</p>
      )}
      <p className="muted">
        This feed only lists the ~200 matches shown in the in-game Watch tab, so most matches won't appear. See the
        README for how to get a live feed for any match.
      </p>
    </div>
  );
}

function MatchHeader({ match, myTeam }: { match: ActiveMatch; myTeam: number }) {
  const [mine, theirs] =
    myTeam === 0
      ? [match.net_worth_team_0 ?? 0, match.net_worth_team_1 ?? 0]
      : [match.net_worth_team_1 ?? 0, match.net_worth_team_0 ?? 0];
  const diff = mine - theirs;
  return (
    <div className="match-header">
      <Stat label="Match time" value={match.duration_s != null ? formatDuration(match.duration_s) : "–"} />
      <Stat label="Your team" value={formatSouls(mine)} />
      <Stat label="Enemy" value={formatSouls(theirs)} />
      <Stat
        label="Soul lead"
        value={formatSignedSouls(diff)}
        tone={diff > 0 ? "ally" : diff < 0 ? "enemy" : undefined}
      />
      <Stat label="Mode" value={match.match_mode_parsed ?? "–"} />
      <Stat label="Spectators" value={String(match.spectators ?? 0)} />
    </div>
  );
}

function Teams({ match, myTeam, heroes }: { match: ActiveMatch; myTeam: number; heroes: HeroMap }) {
  const [names, setNames] = useState(new Map<number, string>());
  const ids = match.players.map((p) => p.account_id).filter((id): id is number => id != null);
  const idsKey = ids.join(",");

  useEffect(() => {
    getSteamProfiles(ids)
      .then((profiles) => setNames(new Map(profiles.map((p) => [p.account_id, p.personaname]))))
      .catch((e) => console.error("Failed to load profiles", e));
    // `ids` is derived from `idsKey`; only refetch when the roster changes.
  }, [idsKey]);

  const team = (t: number) => match.players.filter((p) => p.team === t);
  return (
    <div className="teams">
      <TeamColumn title="Your team" tone="ally" players={team(myTeam)} heroes={heroes} names={names} />
      <TeamColumn title="Enemy team" tone="enemy" players={team(1 - myTeam)} heroes={heroes} names={names} />
    </div>
  );
}

function TeamColumn(props: {
  title: string;
  tone: "ally" | "enemy";
  players: ActiveMatchPlayer[];
  heroes: HeroMap;
  names: Map<number, string>;
}) {
  return (
    <div className={`team team--${props.tone}`}>
      <h3>{props.title}</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Hero</th>
            <th>Player</th>
            <th className="num" title="Win rate over their last 20 scored matches">Recent WR</th>
            <th className="num" title="Their all-time record on this hero (as far as deadlock-api knows)">On hero</th>
            <th>Most played</th>
          </tr>
        </thead>
        <tbody>
          {props.players.map((p, i) => (
            <PlayerRow key={p.account_id ?? i} player={p} heroes={props.heroes} name={props.names.get(p.account_id ?? -1)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayerRow({ player, heroes, name }: { player: ActiveMatchPlayer; heroes: HeroMap; name?: string }) {
  const [history, setHistory] = useState<MatchHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (player.account_id == null) return;
    let cancelled = false;
    getMatchHistory(player.account_id)
      .then((h) => !cancelled && setHistory(h))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [player.account_id]);

  const summary = history ? summarize(history) : null;
  const onHero = history && player.hero_id != null ? heroRecord(history, player.hero_id) : null;
  const pending = !history && !failed;

  return (
    <tr className={player.abandoned ? "abandoned" : undefined}>
      <td>
        <HeroBadge heroId={player.hero_id} heroes={heroes} />
      </td>
      <td>{name ?? (player.account_id != null ? `#${player.account_id}` : "Anonymous")}</td>
      <td className="num">{pending ? "…" : summary?.games ? formatPercent(summary.winRate) : "–"}</td>
      <td className="num">
        {pending ? "…" : !onHero ? "–" : onHero.games > 0 ? `${onHero.wins}–${onHero.games - onHero.wins}` : "0 games"}
      </td>
      <td>
        <span className="hero-row">
          {summary?.topHeroes.map((h) => <HeroBadge key={h.heroId} heroId={h.heroId} heroes={heroes} compact />)}
        </span>
      </td>
    </tr>
  );
}
