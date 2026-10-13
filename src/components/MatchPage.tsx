import { useState } from "react";
import type { MatchDetail, MatchPlayer } from "../api/native";
import { MATCH_MODE_LABELS } from "../api/types";
import type { HeroMap } from "../hooks/useHeroes";
import type { ItemMap } from "../hooks/useItems";
import { useMatchDetail } from "../hooks/useMatchDetail";
import { formatDateTime, formatDuration, formatKda, formatRelativeTime, formatSouls } from "../lib/format";
import { heroByCodename } from "../lib/matchInsights";
import { HeroBadge } from "./HeroBadge";
import { ItemIcon } from "./ItemTooltip";
import { KillTimeline, type TimelineEvent } from "./KillTimeline";
import { MatchReportPanel } from "./MatchReportPanel";
import { SOURCES } from "./MatchTable";
import { NetWorthChart, type TeamLabels } from "./NetWorthChart";
import { PlayerBars, TeamComparison, type HeroOf } from "./PlayerComparison";
import { Stat } from "./Stat";
import { sidesClass, TEAM_BY_INDEX, TEAM_NAMES } from "../lib/teams";

const teamName = (t: number) => TEAM_NAMES[TEAM_BY_INDEX[t]];
const KILLFEED_SHOWN = 15;

interface Props {
  matchId: number;
  /** Whose side the page takes: their team is "ally" in every chart. */
  accountId: number;
  selfId: number;
  heroes: HeroMap;
  items: ItemMap;
  onBack: () => void;
  onOpenPlayer: (accountId: number) => void;
}

/** Everything the local database has on one match. */
export function MatchPage({ matchId, accountId, selfId, heroes, items, onBack, onOpenPlayer }: Props) {
  const { detail, missing, error } = useMatchDetail(matchId);
  const allyTeam = detail?.players.find((p) => p.account_id === accountId)?.team ?? 0;

  return (
    <div className={`sides ${sidesClass(TEAM_BY_INDEX[allyTeam])}`}>
      <section className="panel panel--wide">
        <header className="panel__header">
          <div className="profile-title">
            <button className="button" onClick={onBack}>
              ← Back
            </button>
            <h2>Match {matchId}</h2>
            {detail && <Sources detail={detail} />}
          </div>
          {detail?.start_time != null && (
            <span className="muted" title={formatDateTime(detail.start_time)}>
              {formatDateTime(detail.start_time)} · {formatRelativeTime(detail.start_time)}
            </span>
          )}
        </header>
        {error && <p className="error">Couldn't read the match: {error}</p>}
        {missing && <p className="muted">This match isn't saved locally.</p>}
        {!detail && !missing && !error && <p className="muted">Loading…</p>}
        {detail && <Overview detail={detail} accountId={accountId} selfId={selfId} heroes={heroes} />}
      </section>
      {detail && (
        <Sections
          detail={detail}
          accountId={accountId}
          selfId={selfId}
          heroes={heroes}
          items={items}
          onOpenPlayer={onOpenPlayer}
        />
      )}
    </div>
  );
}

/** Perspective and lookups shared by every section. */
function usePerspective(detail: MatchDetail, accountId: number, selfId: number, heroes: HeroMap) {
  const me = detail.players.find((p) => p.account_id === accountId);
  const myTeam = me?.team ?? 0;
  const enemyTeam = 1 - myTeam;
  const isSelf = accountId === selfId;
  const labels: TeamLabels =
    isSelf && me?.team != null
      ? { ally: "Your team", enemy: "Enemy" }
      : { ally: teamName(myTeam), enemy: teamName(enemyTeam) };
  const reportHero = heroByCodename(heroes, detail.report?.my_hero ?? null)?.id;
  const heroOf: HeroOf = (p) => p.hero_id ?? (p.account_id === detail.report_account ? reportHero : undefined);
  const byAccount = new Map(detail.players.map((p) => [p.account_id, p]));
  return { me, myTeam, enemyTeam, isSelf, labels, heroOf, byAccount, reportHero };
}

function Sources({ detail }: { detail: MatchDetail }) {
  const sources = new Set([detail.source, ...detail.players.map((p) => p.source)]);
  if (detail.report) sources.add("console");
  return (
    <span className="hero-row">
      {(["history", "live", "console"] as const)
        .filter((s) => sources.has(s))
        .map((s) => (
          <span key={s} className="tag" title={SOURCES[s].title}>
            {SOURCES[s].label}
          </span>
        ))}
    </span>
  );
}

function Overview({
  detail,
  accountId,
  selfId,
  heroes,
}: {
  detail: MatchDetail;
  accountId: number;
  selfId: number;
  heroes: HeroMap;
}) {
  const { me, myTeam, isSelf, labels, heroOf, reportHero, byAccount } = usePerspective(detail, accountId, selfId, heroes);
  const won = me?.team != null && detail.winning_team != null ? detail.winning_team === me.team : null;
  const hasKda = me?.kills != null && me.deaths != null && me.assists != null;
  const heroId = me ? heroOf(me) : detail.report_account === accountId ? reportHero : undefined;
  // Kills scored by team `t`: victims on the other team.
  const teamKills = (t: number) =>
    detail.kills.filter((k) => byAccount.get(k.victim_account ?? -1)?.team === 1 - t).length;
  const result =
    won !== null
      ? won
        ? "Victory"
        : "Defeat"
      : detail.winning_team != null
        ? `${teamName(detail.winning_team)} won`
        : "Unknown";
  const mode = detail.match_mode != null ? (MATCH_MODE_LABELS[detail.match_mode] ?? String(detail.match_mode)) : "–";
  const notes = coverageNotes(detail, me, isSelf);

  return (
    <>
      <div className="match-header">
        <Stat label="Result" value={result} tone={won === true ? "ally" : won === false ? "enemy" : undefined} />
        <div className="stat">
          <span className="stat__label">{isSelf ? "Your hero" : "Hero"}</span>
          <span className="stat__value">{heroId != null ? <HeroBadge heroId={heroId} heroes={heroes} /> : "–"}</span>
        </div>
        <Stat label="K / D / A" value={hasKda ? `${me.kills} / ${me.deaths} / ${me.assists}` : "–"} />
        <Stat label="KDA" value={hasKda ? formatKda(me.kills!, me.deaths!, me.assists!) : "–"} />
        <Stat label="Souls" value={me?.net_worth != null ? formatSouls(me.net_worth) : "–"} />
        <Stat label="Level" value={me?.level != null ? String(me.level) : "–"} />
        <Stat label="Length" value={detail.duration_s != null ? formatDuration(detail.duration_s) : "–"} />
        <Stat label="Mode" value={mode} />
        {detail.kills.length > 0 && (
          <Stat label="Kill score" value={`${teamKills(myTeam)} – ${teamKills(1 - myTeam)}`} />
        )}
      </div>
      <TeamComparison players={detail.players} myTeam={myTeam} labels={labels} />
      {notes.map((n) => (
        <p key={n} className="muted match-note">
          {n}
        </p>
      ))}
      <details className="report-details">
        <summary>Match details</summary>
        <dl className="kv">
          <dt>Match ID</dt>
          <dd>{detail.match_id}</dd>
          <dt>Started</dt>
          <dd>{detail.start_time != null ? formatDateTime(detail.start_time) : "–"}</dd>
          <dt>Map</dt>
          <dd>{detail.map ?? "–"}</dd>
          <dt>Build</dt>
          <dd>{detail.build ?? "–"}</dd>
          <dt>Players saved</dt>
          <dd>{detail.players.length}</dd>
          <dt>Kills saved</dt>
          <dd>{detail.kills.length}</dd>
          <dt>Best source</dt>
          <dd>{SOURCES[detail.source].title}</dd>
        </dl>
      </details>
    </>
  );
}

/** What's missing and why, so gaps don't read as zeros. */
function coverageNotes(detail: MatchDetail, me: MatchPlayer | undefined, isSelf: boolean): string[] {
  const notes: string[] = [];
  const hasBroadcast = detail.souls_history.length > 0 || detail.kills.length > 0 || detail.players.length > 1;
  if (!hasBroadcast) {
    notes.push(
      detail.source === "console"
        ? "Only your console log saw this match, so there's no result or scoreboard."
        : `Only ${isSelf ? "your" : "this player's"} stats from deadlock-api are saved. The full scoreboard, ` +
            "kill feed and soul graph are recorded from the live broadcast while the app is open.",
    );
  } else if (detail.winning_team == null) {
    notes.push("Result unknown: the broadcast wasn't watched to the end and deadlock-api hasn't reported it yet.");
  }
  if (!me && detail.players.length > 0) {
    notes.push("This player isn't in the saved scoreboard; teams are shown as Hidden King and Archmother.");
  }
  return notes;
}

function Sections({
  detail,
  accountId,
  selfId,
  heroes,
  items,
  onOpenPlayer,
}: {
  detail: MatchDetail;
  accountId: number;
  selfId: number;
  heroes: HeroMap;
  items: ItemMap;
  onOpenPlayer: (accountId: number) => void;
}) {
  const p = usePerspective(detail, accountId, selfId, heroes);
  const { myTeam, labels, heroOf, byAccount } = p;
  const name = (id: number | null) => {
    const player = id != null ? byAccount.get(id) : undefined;
    if (!player) return null;
    const hero = heroes.get(heroOf(player) ?? -1)?.name;
    const persona = player.persona_name ?? `Player ${player.account_id}`;
    return hero ? `${hero} (${persona})` : persona;
  };

  // Kills, or failing that your own deaths from the console log.
  const events: TimelineEvent[] = [];
  for (const k of detail.kills) {
    if (k.clock == null) continue;
    const side = killSide(k, byAccount, myTeam);
    if (!side) continue;
    const assists = k.assister_accounts.length;
    events.push({
      t: k.clock,
      side,
      label: `${name(k.attacker_account) ?? "Troopers / objective"} killed ${name(k.victim_account) ?? "a player"}`,
      detail: joinParts(
        assists ? `${assists} assist${assists === 1 ? "" : "s"}` : null,
        k.souls ? `${formatSouls(k.souls)} souls` : null,
      ),
      mine: k.attacker_account === accountId || k.victim_account === accountId,
    });
  }
  if (detail.kills.length === 0 && detail.report && detail.report_account === accountId) {
    for (const d of detail.report.deaths) {
      const killcam = heroByCodename(heroes, d.spectated)?.name;
      events.push({
        t: d.match_time,
        side: "enemy",
        label: p.isSelf ? "You died" : "Died",
        detail: joinParts(
          killcam ? `Killcam: ${killcam}` : null,
          d.respawn_secs != null ? `${d.respawn_secs}s respawn` : null,
        ),
        mine: true,
      });
    }
  }

  const samples = detail.souls_history.map((s) => ({
    t: s.clock,
    diff: myTeam === 0 ? s.amber - s.sapphire : s.sapphire - s.amber,
  }));
  const end = Math.max(detail.duration_s ?? 0, samples.at(-1)?.t ?? 0, ...events.map((e) => e.t));
  const domain: [number, number] = [0, Math.max(60, end)];
  const hasSouls = samples.length >= 2;
  const timelineCaption = joinParts(
    hasSouls ? "Soul lead" : null,
    detail.kills.length > 0 ? "kills" : events.length > 0 ? "deaths from your console log" : null,
  );
  const showBars = detail.players.filter((pl) => pl.net_worth != null || pl.hero_damage != null).length >= 2;

  return (
    <>
      {(hasSouls || events.length > 0) && (
        <section className="panel panel--wide">
          <header className="panel__header">
            <h2>Timeline</h2>
            <span className="muted">{timelineCaption}</span>
          </header>
          {hasSouls && <NetWorthChart samples={[{ t: 0, diff: 0 }, ...samples]} domain={domain} labels={labels} />}
          {events.length > 0 && <KillTimeline events={events} domain={domain} labels={labels} />}
        </section>
      )}

      {detail.players.length > 0 && (
        <section className="panel panel--wide">
          <header className="panel__header">
            <h2>Scoreboard</h2>
            {detail.players.some((pl) => pl.items?.length) && (
              <span className="muted">Items as last seen on the broadcast, in purchase order</span>
            )}
          </header>
          <div className="teams teams--stacked">
            {[myTeam, 1 - myTeam].map((t) => {
              const team = detail.players.filter((pl) => pl.team === t);
              if (team.length === 0) return null;
              return (
                <ScoreTable
                  key={t}
                  title={`${teamName(t)}${t === myTeam && p.isSelf && p.me ? " · your team" : ""}${
                    detail.winning_team === t ? " · won" : ""
                  }`}
                  tone={t === myTeam ? "ally" : "enemy"}
                  players={team}
                  all={detail.players}
                  focusId={accountId}
                  heroes={heroes}
                  items={items}
                  heroOf={heroOf}
                  onOpenPlayer={onOpenPlayer}
                />
              );
            })}
            {detail.players.some((pl) => pl.team == null) && (
              <ScoreTable
                title="Team unknown"
                players={detail.players.filter((pl) => pl.team == null)}
                all={detail.players}
                focusId={accountId}
                heroes={heroes}
                items={items}
                heroOf={heroOf}
                onOpenPlayer={onOpenPlayer}
              />
            )}
          </div>
        </section>
      )}

      {showBars && (
        <section className="panel">
          <header className="panel__header">
            <h2>Compare players</h2>
          </header>
          <PlayerBars
            players={detail.players}
            myTeam={myTeam}
            labels={labels}
            heroes={heroes}
            heroOf={heroOf}
            focusId={accountId}
            onOpenPlayer={onOpenPlayer}
          />
        </section>
      )}

      {detail.kills.length > 0 && (
        <KillFeed
          detail={detail}
          accountId={accountId}
          isSelf={p.isSelf}
          myTeam={myTeam}
          byAccount={byAccount}
          heroes={heroes}
          heroOf={heroOf}
        />
      )}

      {detail.report && <MatchReportPanel report={detail.report} heroes={heroes} />}
    </>
  );
}

/** Which team scored a kill, from the victim's team (or the attacker's when the victim is unknown). */
function killSide(
  k: MatchDetail["kills"][number],
  byAccount: Map<number, MatchPlayer>,
  myTeam: number,
): "ally" | "enemy" | null {
  const victimTeam = byAccount.get(k.victim_account ?? -1)?.team;
  if (victimTeam != null) return victimTeam === myTeam ? "enemy" : "ally";
  const attackerTeam = byAccount.get(k.attacker_account ?? -1)?.team;
  if (attackerTeam != null) return attackerTeam === myTeam ? "ally" : "enemy";
  return null;
}

/** "a · b" from the parts that are set; first letter capitalised. */
function joinParts(...parts: (string | null)[]): string | undefined {
  const text = parts.filter(Boolean).join(" · ");
  return text ? text[0].toUpperCase() + text.slice(1) : undefined;
}

const STAT_KEYS = [
  "level",
  "kills",
  "deaths",
  "assists",
  "net_worth",
  "last_hits",
  "denies",
  "hero_damage",
  "objective_damage",
  "healing",
] as const;
type StatLine = Pick<MatchPlayer, (typeof STAT_KEYS)[number]>;

function statCell(p: StatLine, key: keyof StatLine) {
  switch (key) {
    case "kills":
      return p.kills != null ? `${p.kills} / ${p.deaths ?? "–"} / ${p.assists ?? "–"}` : "–";
    case "last_hits":
      return p.last_hits != null ? `${p.last_hits} / ${p.denies ?? "–"}` : "–";
    case "level":
      return p.level ?? "";
    default:
      return p[key] != null ? formatSouls(p[key]) : "–";
  }
}

const COLUMNS: { key: keyof StatLine; label: string; title?: string }[] = [
  { key: "level", label: "Lvl" },
  { key: "kills", label: "K / D / A" },
  { key: "net_worth", label: "Souls" },
  { key: "last_hits", label: "LH / DN", title: "Last hits / denies" },
  { key: "hero_damage", label: "Hero dmg" },
  { key: "objective_damage", label: "Obj dmg", title: "Objective damage" },
  { key: "healing", label: "Healing" },
];

function ScoreTable(props: {
  title: string;
  tone?: "ally" | "enemy";
  players: MatchPlayer[];
  /** Every player in the match: a column shows if anyone has it, so both tables match. */
  all: MatchPlayer[];
  focusId: number;
  heroes: HeroMap;
  items: ItemMap;
  heroOf: HeroOf;
  onOpenPlayer: (accountId: number) => void;
}) {
  const columns = COLUMNS.filter((c) => props.all.some((p) => p[c.key] != null));
  const showItems = props.all.some((p) => p.items?.length);
  // Team totals; a stat is only summed when every player on the team has it.
  const totals = Object.fromEntries(
    STAT_KEYS.map((key) => [
      key,
      key !== "level" && props.players.every((p) => p[key] != null)
        ? props.players.reduce((s, p) => s + (p[key] ?? 0), 0)
        : null,
    ]),
  ) as StatLine;

  return (
    <div className={`team ${props.tone ? `team--${props.tone}` : ""}`}>
      <h3>{props.title}</h3>
      <table className="table live-table">
        <thead>
          <tr>
            <th>Player</th>
            {columns.map((c) => (
              <th key={c.key} className="num" title={c.title}>
                {c.label}
              </th>
            ))}
            {showItems && <th>Items</th>}
          </tr>
        </thead>
        <tbody>
          {props.players.map((p) => (
            <tr
              key={p.account_id}
              className={[p.account_id === props.focusId ? "me" : "", p.abandoned ? "abandoned" : ""].join(" ")}
            >
              <td>
                <span className="live-player">
                  <HeroBadge heroId={props.heroOf(p)} heroes={props.heroes} compact />
                  <button
                    className="link live-player__name"
                    title={`Open ${p.persona_name ?? "player"}'s profile`}
                    onClick={() => props.onOpenPlayer(p.account_id)}
                  >
                    {p.persona_name ?? `Player ${p.account_id}`}
                  </button>
                  {p.abandoned && <span className="tag">left</span>}
                </span>
              </td>
              {columns.map((c) => (
                <td key={c.key} className="num">
                  {c.key === "level" ? (p.level ?? "–") : statCell(p, c.key)}
                </td>
              ))}
              {showItems && (
                <td>
                  <span className="items">
                    {(p.items ?? []).map((id, i) => (
                      <ItemIcon key={`${id}-${i}`} id={id} items={props.items} />
                    ))}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {props.players.length > 1 && (
          <tfoot>
            <tr>
              <td className="muted">Total</td>
              {columns.map((c) => (
                <td key={c.key} className="num muted">
                  {statCell(totals, c.key)}
                </td>
              ))}
              {showItems && <td />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function KillFeed({
  detail,
  accountId,
  isSelf,
  myTeam,
  byAccount,
  heroes,
  heroOf,
}: {
  detail: MatchDetail;
  accountId: number;
  isSelf: boolean;
  myTeam: number;
  byAccount: Map<number, MatchPlayer>;
  heroes: HeroMap;
  heroOf: HeroOf;
}) {
  const [onlyMine, setOnlyMine] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const inMatch = byAccount.has(accountId);
  const kills = detail.kills.filter(
    (k) =>
      !onlyMine ||
      k.attacker_account === accountId ||
      k.victim_account === accountId ||
      k.assister_accounts.includes(accountId),
  );
  const shown = showAll ? kills : kills.slice(0, KILLFEED_SHOWN);
  const badge = (id: number | null) => {
    const player = id != null ? byAccount.get(id) : undefined;
    return player ? (
      <span className="live-player">
        <HeroBadge heroId={heroOf(player)} heroes={heroes} compact />
        <span className="live-player__name">{player.persona_name ?? `Player ${player.account_id}`}</span>
      </span>
    ) : null;
  };

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Kill feed</h2>
        {inMatch && (
          <label className="checkbox muted">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
            Only {isSelf ? "you" : (byAccount.get(accountId)?.persona_name ?? "this player")}
          </label>
        )}
      </header>
      {kills.length === 0 ? (
        <p className="muted">No kills involving this player were saved.</p>
      ) : (
        <ol className="killfeed">
          {shown.map((k, i) => {
            return (
              <li key={i} className={`killfeed--${killSide(k, byAccount, myTeam) ?? "enemy"}`}>
                <span className="killfeed__time">{k.clock != null ? formatDuration(k.clock) : ""}</span>
                {badge(k.attacker_account) ?? <span className="muted">Troopers / objective</span>}
                <span className="killfeed__arrow" aria-label="killed">
                  →
                </span>
                {badge(k.victim_account) ?? <span className="muted">?</span>}
                {k.assister_accounts.length > 0 && (
                  <span className="hero-row" title="Assists">
                    +
                    {k.assister_accounts.map((a) => (
                      <HeroBadge
                        key={a}
                        heroId={byAccount.has(a) ? heroOf(byAccount.get(a)!) : undefined}
                        heroes={heroes}
                        compact
                      />
                    ))}
                  </span>
                )}
                {k.souls > 0 && <span className="muted killfeed__souls">{formatSouls(k.souls)} souls</span>}
              </li>
            );
          })}
        </ol>
      )}
      {kills.length > KILLFEED_SHOWN && (
        <button className="link killfeed__more" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show fewer" : `Show all ${kills.length} kills`}
        </button>
      )}
    </section>
  );
}
