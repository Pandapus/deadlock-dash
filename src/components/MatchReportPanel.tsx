import type { MatchReport } from "../api/native";
import type { HeroMap } from "../hooks/useHeroes";
import { formatDuration } from "../lib/format";
import { heroByCodename, heroName, hitTotal, matchInsights, relayName } from "../lib/matchInsights";
import { HeroBadge } from "./HeroBadge";
import { Stat } from "./Stat";

const PHASE_LABELS: Record<MatchReport["phase"], string> = {
  loading: "Loading",
  intro: "Intro",
  in_progress: "In progress",
  post_game: "Post-game",
  ended: "Finished",
};

/**
 * What console.log reveals about your current or last match. The log has no
 * scoreboard, so this is inferred from engine side-effects; see
 * src-tauri/src/match_report.rs for how each field is derived.
 */
export function MatchReportPanel({ report, heroes }: { report: MatchReport | null; heroes: HeroMap }) {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Match report</h2>
        {report && (
          <span className="muted">
            Match {report.match_id} · {PHASE_LABELS[report.phase]}
          </span>
        )}
      </header>
      {!report ? (
        <p className="muted">
          Play a match with <code>-condebug</code> on and this fills in from the console log: your hero, deaths,
          hit-registration, connection and frame-rate.
        </p>
      ) : (
        <Report report={report} heroes={heroes} />
      )}
    </section>
  );
}

function Report({ report: r, heroes }: { report: MatchReport; heroes: HeroMap }) {
  const insights = matchInsights(r, heroes);
  const roster = r.roster.filter((h) => h !== r.my_hero);
  const hits = r.hit_reg;
  return (
    <>
      <div className="match-header">
        <div className="stat">
          <span className="stat__label">Your hero</span>
          <span className="stat__value">
            {r.my_hero ? <HeroBadge heroId={heroByCodename(heroes, r.my_hero)?.id} heroes={heroes} /> : "–"}
          </span>
        </div>
        <Stat label="Length" value={r.duration_secs != null ? formatDuration(r.duration_secs) : "–"} />
        <Stat label="Deaths" value={r.phase === "loading" ? "–" : String(r.deaths.length)} />
        <Stat label="Ping" value={r.network.ping_p50 != null ? `${r.network.ping_p50} ms` : "–"} />
        <Stat label="FPS (avg / 1%)" value={fps(r)} />
        <Stat label="Queue" value={r.queue_secs != null ? formatDuration(r.queue_secs) : "–"} />
      </div>

      {insights.length > 0 && (
        <ul className="insights">
          {insights.map((i) => (
            <li key={i.text} className={`insight insight--${i.tone}`}>
              <span className="insight__tag">{i.tone === "good" ? "Good" : i.tone === "warn" ? "Check" : "Note"}</span>
              {i.text}
            </li>
          ))}
        </ul>
      )}

      {r.deaths.length > 0 && (
        <>
          <h3>Deaths</h3>
          <table className="table">
            <thead>
              <tr>
                <th className="num">Match time</th>
                <th>Killcam</th>
                <th className="num">Respawn</th>
              </tr>
            </thead>
            <tbody>
              {r.deaths.map((d) => (
                <tr key={d.at}>
                  <td className="num">{formatDuration(d.match_time)}</td>
                  <td>
                    {d.spectated ? (
                      <HeroBadge heroId={heroByCodename(heroes, d.spectated)?.id} heroes={heroes} />
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                  <td className="num">{d.respawn_secs != null ? `${d.respawn_secs}s` : "dead"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {roster.length > 0 && (
        <p className="report-line">
          <span className="stat__label">Heroes loaded at match start (approx.)</span>
          <span className="hero-row">
            {roster.map((h) => {
              const hero = heroByCodename(heroes, h);
              return hero ? (
                <HeroBadge key={h} heroId={hero.id} heroes={heroes} compact />
              ) : (
                <code key={h}>{heroName(heroes, h)}</code>
              );
            })}
          </span>
        </p>
      )}

      <details className="report-details">
        <summary>Details</summary>
        <dl className="kv">
          <dt>Map</dt>
          <dd>{r.map ?? "–"}</dd>
          <dt>Players at connect</dt>
          <dd>{r.players ?? "–"}</dd>
          <dt>Load time</dt>
          <dd>{r.load_secs != null ? formatDuration(r.load_secs) : "–"}</dd>
          <dt>Server relay</dt>
          <dd>
            {relayName(r.network.relay)}
            {r.network.relay_ping != null && ` (${r.network.relay_ping} ms)`}
          </dd>
          <dt>Nearest relays</dt>
          <dd>{r.network.nearest_relays.map(([c, ms]) => `${relayName(c)} ${ms} ms`).join(", ") || "–"}</dd>
          <dt>Ping P50 / P95</dt>
          <dd>{r.network.ping_p50 != null ? `${r.network.ping_p50} / ${r.network.ping_p95} ms` : "–"}</dd>
          <dt>Jitter P99</dt>
          <dd>{r.network.jitter_p99 != null ? `${r.network.jitter_p99} ms` : "–"}</dd>
          <dt>Server ticks on time</dt>
          <dd>{r.network.ticks_on_time_pct != null ? `${r.network.ticks_on_time_pct}%` : "–"}</dd>
          <dt>Packet loss</dt>
          <dd>{r.network.dropped_pct != null ? `${r.network.dropped_pct}%` : "–"}</dd>
          <dt>Clock re-syncs</dt>
          <dd>{r.network.tick_resyncs}</dd>
          <dt>Hit mismatches</dt>
          <dd>
            {hitTotal(hits.lost) + hitTotal(hits.gained) + hits.swapped} total · lost {hitTotal(hits.lost)} · gained{" "}
            {hitTotal(hits.gained)} · wrong target {hits.swapped}
          </dd>
          <dt>Shadow-cache overflows</dt>
          <dd>{r.performance.shadow_overflows}</dd>
          <dt>Build</dt>
          <dd>{r.build ?? "–"}</dd>
          <dt>Match found</dt>
          <dd>{r.found_at}</dd>
        </dl>
      </details>
    </>
  );
}

function fps(r: MatchReport): string {
  const { fps_avg, fps_p1 } = r.performance;
  return fps_avg != null && fps_p1 != null ? `${Math.round(fps_avg)} / ${Math.round(fps_p1)}` : "–";
}
