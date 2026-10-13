import type { LivePlayer, LiveState } from "../api/native";
import type { HeroMap } from "../hooks/useHeroes";
import type { ItemMap } from "../hooks/useItems";
import { formatClock, formatSignedSouls, formatSouls } from "../lib/format";
import { HeroBadge } from "./HeroBadge";
import { ItemIcon } from "./ItemTooltip";
import { NetWorthChart } from "./NetWorthChart";
import { Stat } from "./Stat";

const TEAM_NAMES: Record<number, string> = { 2: "Amber", 3: "Sapphire" };
const KILLFEED_SHOWN = 8;

const STATUS_LABELS: Record<LiveState["status"], string> = {
  resolving: "Connecting…",
  waiting: "Waiting for broadcast…",
  live: "Live",
  ended: "Ended",
  error: "Error",
};

interface Props {
  live: LiveState;
  accountId: number;
  heroes: HeroMap;
  items: ItemMap;
  onStop: () => void;
}

/**
 * Scoreboard streamed from the match's spectator broadcast (see
 * src-tauri/src/live.rs). Runs behind the real game by Valve's spectator delay.
 */
export function LiveScoreboard({ live, accountId, heroes, items, onStop }: Props) {
  const me = live.players.find((p) => p.account_id === accountId);
  // If you aren't in the match (e.g. spectating), show Amber on the left.
  const myTeam = me?.team ?? 2;
  const enemyTeam = myTeam === 2 ? 3 : 2;
  const team = (t: number) => live.players.filter((p) => p.team === t);
  const souls = (t: number) => team(t).reduce((s, p) => s + p.net_worth, 0);
  const lead = souls(myTeam) - souls(enemyTeam);
  const streetBrawl = live.round > 0 || live.amber_score > 0 || live.sapphire_score > 0;
  const score = (t: number) => (t === 2 ? live.amber_score : live.sapphire_score);
  const running = live.status === "live" || live.status === "waiting" || live.status === "resolving";
  const samples = live.souls_history.map((s) => ({
    t: s.clock,
    diff: myTeam === 2 ? s.amber - s.sapphire : s.sapphire - s.amber,
  }));
  const bySlot = new Map(live.players.map((p) => [p.slot, p]));

  return (
    <section className="panel panel--wide">
      <header className="panel__header">
        <h2>Live match</h2>
        <span className="live-status">
          <span className={`pill ${live.status === "live" ? "pill--good" : live.status === "error" ? "pill--bad" : ""}`}>
            {STATUS_LABELS[live.status]}
          </span>
          <span className="muted">
            Match {live.match_id} · spectator feed, runs behind the game
          </span>
          {running && (
            <button className="link" onClick={onStop}>
              Stop
            </button>
          )}
        </span>
      </header>
      {live.message && <p className={live.status === "error" ? "error" : "muted"}>{live.message}</p>}

      {live.players.length === 0 ? (
        live.status !== "error" && (
          <p className="muted">
            Connecting to the broadcast. Fresh matches take a minute or two before the relay has data.
          </p>
        )
      ) : (
        <>
          <div className="match-header">
            <Stat label="Match time" value={live.clock != null ? formatClock(live.clock) : "–"} />
            {streetBrawl && (
              <Stat
                label={`Round ${live.round}`}
                value={`${score(myTeam)} – ${score(enemyTeam)}`}
                tone={score(myTeam) > score(enemyTeam) ? "ally" : score(myTeam) < score(enemyTeam) ? "enemy" : undefined}
              />
            )}
            <Stat label={me ? "Your team" : TEAM_NAMES[myTeam]} value={formatSouls(souls(myTeam))} />
            <Stat label={me ? "Enemy" : TEAM_NAMES[enemyTeam]} value={formatSouls(souls(enemyTeam))} />
            <Stat
              label="Soul lead"
              value={formatSignedSouls(lead)}
              tone={lead > 0 ? "ally" : lead < 0 ? "enemy" : undefined}
            />
            {live.winning_team != null && (
              <Stat
                label="Result"
                value={me ? (live.winning_team === myTeam ? "Victory" : "Defeat") : `${TEAM_NAMES[live.winning_team]} won`}
                tone={live.winning_team === myTeam ? "ally" : "enemy"}
              />
            )}
          </div>

          <NetWorthChart samples={samples} emptyText="Soul lead graph appears after the first 20 seconds of match time." />

          <div className="teams">
            {[myTeam, enemyTeam].map((t) => (
              <TeamTable
                key={t}
                title={me ? (t === myTeam ? "Your team" : "Enemy team") : `${TEAM_NAMES[t]}`}
                tone={t === myTeam ? "ally" : "enemy"}
                players={team(t).sort((a, b) => b.net_worth - a.net_worth)}
                meSlot={me?.slot}
                heroes={heroes}
                items={items}
              />
            ))}
          </div>

          {live.kills.length > 0 && (
            <>
              <h3 className="killfeed-title">Kill feed</h3>
              <ol className="killfeed">
                {live.kills
                  .slice(-KILLFEED_SHOWN)
                  .reverse()
                  .map((k, i) => {
                    const attacker = k.attacker != null ? bySlot.get(k.attacker) : undefined;
                    const victim = k.victim != null ? bySlot.get(k.victim) : undefined;
                    const allyKill = attacker?.team === myTeam;
                    return (
                      <li key={`${k.clock}-${k.victim}-${i}`} className={allyKill ? "killfeed--ally" : "killfeed--enemy"}>
                        <span className="killfeed__time">{k.clock != null ? formatClock(k.clock) : ""}</span>
                        {attacker ? <HeroBadge heroId={attacker.hero_id} heroes={heroes} /> : <span className="muted">Troopers / objective</span>}
                        <span className="killfeed__arrow" aria-label="killed">
                          →
                        </span>
                        {victim ? <HeroBadge heroId={victim.hero_id} heroes={heroes} /> : <span className="muted">?</span>}
                        {k.assisters.length > 0 && (
                          <span className="hero-row" title="Assists">
                            +
                            {k.assisters.map((a) => (
                              <HeroBadge key={a} heroId={bySlot.get(a)?.hero_id} heroes={heroes} compact />
                            ))}
                          </span>
                        )}
                        {k.souls > 0 && <span className="muted killfeed__souls">{formatSouls(k.souls)} souls</span>}
                      </li>
                    );
                  })}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}

function TeamTable(props: {
  title: string;
  tone: "ally" | "enemy";
  players: LivePlayer[];
  meSlot?: number;
  heroes: HeroMap;
  items: ItemMap;
}) {
  return (
    <div className={`team team--${props.tone}`}>
      <h3>{props.title}</h3>
      <table className="table live-table">
        <thead>
          <tr>
            <th>Hero</th>
            <th className="num">Lvl</th>
            <th className="num">Souls</th>
            <th className="num">K / D / A</th>
            <th className="num" title="Hero damage">Dmg</th>
            <th>Items</th>
          </tr>
        </thead>
        <tbody>
          {props.players.map((p) => (
            <tr
              key={p.slot}
              className={[p.slot === props.meSlot ? "me" : "", p.alive ? "" : "dead", p.abandoned ? "abandoned" : ""].join(" ")}
            >
              <td>
                <span className="live-player">
                  <HeroBadge heroId={p.hero_id} heroes={props.heroes} compact />
                  <span className="live-player__name" title={p.name}>
                    {p.name}
                  </span>
                  {!p.alive && <span className="tag">dead</span>}
                  {p.kill_streak >= 3 && <span className="tag tag--accent">{p.kill_streak} streak</span>}
                </span>
              </td>
              <td className="num">{p.level}</td>
              <td className="num">{formatSouls(p.net_worth)}</td>
              <td className="num">
                {p.kills} / {p.deaths} / {p.assists}
              </td>
              <td className="num">{formatSouls(p.hero_damage)}</td>
              <td>
                <ItemRow ids={p.items} items={props.items} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemRow({ ids, items }: { ids: number[]; items: ItemMap }) {
  return (
    <span className="items">
      {ids.map((id, i) => (
        <ItemIcon key={`${id}-${i}`} id={id} items={items} />
      ))}
    </span>
  );
}
