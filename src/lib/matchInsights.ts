import type { HitCounts, MatchReport } from "../api/native";
import type { HeroMap } from "../hooks/useHeroes";
import type { Hero } from "../api/types";
import { formatDuration } from "./format";

/** Steam Datagram Relay codes → city. */
const RELAYS: Record<string, string> = {
  ams: "Amsterdam",
  atl: "Atlanta",
  bom: "Mumbai",
  can: "Guangzhou",
  dfra: "Frankfurt",
  dxb: "Dubai",
  eat: "Moses Lake",
  fra: "Frankfurt",
  gru: "São Paulo",
  hel: "Helsinki",
  hkg: "Hong Kong",
  iad: "Washington DC",
  jnb: "Johannesburg",
  lax: "Los Angeles",
  lhr: "London",
  lim: "Lima",
  mad: "Madrid",
  maa: "Chennai",
  ord: "Chicago",
  par: "Paris",
  scl: "Santiago",
  sea: "Seattle",
  sgp: "Singapore",
  sto: "Stockholm",
  sto2: "Stockholm",
  syd: "Sydney",
  tyo: "Tokyo",
  vie: "Vienna",
  waw: "Warsaw",
};

export function relayName(code: string | null): string {
  if (!code) return "–";
  return RELAYS[code] ?? code.toUpperCase();
}

export function heroByCodename(heroes: HeroMap, codename: string | null): Hero | undefined {
  if (!codename) return undefined;
  const className = `hero_${codename}`;
  for (const hero of heroes.values()) if (hero.class_name === className) return hero;
  return undefined;
}

export function heroName(heroes: HeroMap, codename: string | null): string {
  return heroByCodename(heroes, codename)?.name ?? codename ?? "Unknown";
}

export interface Insight {
  tone: "good" | "warn" | "info";
  text: string;
}

export const hitTotal = (c: HitCounts) => c.hero + c.trooper + c.objective + c.other;

/** Plain-language takeaways from a match report. Only says what the log supports. */
export function matchInsights(r: MatchReport, heroes: HeroMap): Insight[] {
  const out: Insight[] = [];
  const duration = r.duration_secs ?? 0;

  // Deaths and time dead.
  if (r.phase !== "loading" && r.phase !== "intro") {
    if (r.deaths.length === 0) {
      out.push({ tone: "good", text: "No deaths detected." });
    } else {
      const dead = r.deaths.reduce((s, d) => s + (d.respawn_secs ?? 0), 0);
      const share = duration > 0 ? Math.round((dead / duration) * 100) : 0;
      const killers = new Map<string, number>();
      for (const d of r.deaths) if (d.spectated) killers.set(d.spectated, (killers.get(d.spectated) ?? 0) + 1);
      const top = [...killers].sort((a, b) => b[1] - a[1])[0];
      out.push({
        tone: share >= 25 ? "warn" : "info",
        text:
          `${r.deaths.length} death${r.deaths.length === 1 ? "" : "s"}, ${formatDuration(dead)} spent dead` +
          (share > 0 ? ` (${share}% of the match)` : "") +
          "." +
          (top ? ` Killcam showed ${heroName(heroes, top[0])}${top[1] > 1 ? ` ${top[1]}×` : ""}.` : ""),
      });
    }
  }

  // Hit registration.
  const lostHero = r.hit_reg.lost.hero;
  const gainedHero = r.hit_reg.gained.hero;
  if (lostHero + gainedHero > 0) {
    const net = gainedHero - lostHero;
    out.push({
      tone: lostHero >= 10 && lostHero > gainedHero * 1.5 ? "warn" : "info",
      text:
        `Hit-reg on heroes: ${lostHero} shot${lostHero === 1 ? "" : "s"} looked like hits but didn't count, ` +
        `${gainedHero} counted that looked like misses (net ${net > 0 ? "+" : ""}${net}). ` +
        (Math.abs(net) <= 3 ? "Normal lag-compensation noise." : net < 0 ? "Leaning against you." : "Leaning your way."),
    });
  }
  const objectiveMismatch = r.hit_reg.lost.objective + r.hit_reg.gained.objective;
  if (objectiveMismatch > 0) {
    out.push({ tone: "info", text: `You were shooting objectives (${objectiveMismatch} mismatched shots on guardians/bosses).` });
  }

  // Network.
  const nearest = r.network.nearest_relays[0];
  if (r.network.relay && nearest && r.network.relay_ping != null) {
    const extra = r.network.relay_ping - nearest[1];
    if (extra >= 8 && relayName(r.network.relay) !== relayName(nearest[0])) {
      out.push({
        tone: "info",
        text: `Server was routed via ${relayName(r.network.relay)} (${r.network.relay_ping} ms) although ${relayName(
          nearest[0],
        )} is ${nearest[1]} ms away — probably where the other players were.`,
      });
    }
  }
  const { ping_p50, ping_p95, jitter_p99, ticks_on_time_pct, quality_pct } = r.network;
  const netIssues: string[] = [];
  if (ping_p50 != null && ping_p95 != null && ping_p95 - ping_p50 > 20) netIssues.push(`ping spikes to ${ping_p95} ms`);
  if (jitter_p99 != null && jitter_p99 > 20) netIssues.push(`jitter up to ${jitter_p99} ms`);
  if (ticks_on_time_pct != null && ticks_on_time_pct < 98) netIssues.push(`only ${ticks_on_time_pct}% of server ticks on time`);
  if (quality_pct != null && quality_pct < 99) netIssues.push(`${quality_pct}% connection quality`);
  if (r.network.tick_resyncs > 10) netIssues.push(`${r.network.tick_resyncs} clock re-syncs`);
  if (netIssues.length) out.push({ tone: "warn", text: `Connection trouble: ${netIssues.join(", ")}.` });
  else if (ping_p50 != null) out.push({ tone: "good", text: `Connection was clean (${ping_p50} ms, no loss or spikes).` });

  // Performance.
  const { fps_avg, fps_p1, shadow_overflows } = r.performance;
  if (fps_avg != null && fps_p1 != null) {
    if (fps_p1 < 60) {
      out.push({
        tone: "warn",
        text:
          `Stutter: 1% lows dropped to ${Math.round(fps_p1)} FPS (avg ${Math.round(fps_avg)}).` +
          (shadow_overflows > 50 ? " Busy fights overflowed the shadow cache — lowering shadow quality may help." : ""),
      });
    } else {
      out.push({ tone: "good", text: `Smooth frame rate: ${Math.round(fps_avg)} FPS average, ${Math.round(fps_p1)} at the 1% low.` });
    }
  }

  if (r.left_early) out.push({ tone: "warn", text: "You disconnected before the match ended." });
  if (r.phase === "in_progress" && (ping_p50 == null || fps_avg == null)) {
    out.push({ tone: "info", text: "Network and FPS stats appear once the game writes its next periodic summary (every few minutes)." });
  }
  return out;
}
