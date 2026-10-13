import { isTimerOn } from "../hooks/useTimers";
import { testVoice } from "../hooks/useTimerAlerts";
import type { TimerPrefs } from "../hooks/useSettings";
import { formatClock, formatDuration } from "../lib/format";
import type { GameMode } from "../lib/gameMode";
import { TIMER_KINDS, type TimerEvent, type TimerKind } from "../lib/timers";

const SHOWN = 8;
const LEADS = [10, 20, 30, 45];

interface Props {
  clock: number | null;
  delay: number | null;
  offset: number;
  nudge: (secs: number) => void;
  timers: TimerEvent[];
  hasFeed: boolean;
  mode: GameMode;
  prefs: TimerPrefs;
  onPrefs: (prefs: TimerPrefs) => void;
}

export function TimersPanel({ clock, delay, offset, nudge, timers, hasFeed, mode, prefs, onPrefs }: Props) {
  const toggle = (kind: TimerKind) =>
    onPrefs({ ...prefs, enabled: { ...prefs.enabled, [kind]: !isTimerOn(prefs, kind) } });

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Timers</h2>
        {clock !== null && (
          <span className="timers__clock">
            <button className="button button--small" onClick={() => nudge(-1)} title="Clock is ahead of the game">
              −1s
            </button>
            <strong>{formatClock(clock)}</strong>
            <button className="button button--small" onClick={() => nudge(1)} title="Clock is behind the game">
              +1s
            </button>
          </span>
        )}
      </header>

      {clock === null ? (
        <p className="muted">
          Timers start when the game goes live. They need the console log (the <code>-condebug</code> launch option) to
          know the real match clock, since the spectator feed runs behind.
        </p>
      ) : mode === "street_brawl" ? (
        <p className="muted">Street Brawl has its own rules, so spawn timers are off for this match.</p>
      ) : (
        <>
          <p className="muted timers__note">
            {offset !== 0 && `Adjusted ${offset > 0 ? "+" : ""}${offset}s · `}
            {hasFeed
              ? delay !== null
                ? `Broadcast is ${formatDuration(delay)} behind; respawns it reports show once known.`
                : "Waiting for the broadcast for Mid Boss and camp respawns."
              : "No live feed: Mid Boss and camp respawns won't show."}
          </p>
          {timers.length === 0 ? (
            <p className="muted">Nothing in the next 10 minutes.</p>
          ) : (
            <ul className="timers">
              {timers.slice(0, SHOWN).map((t) => (
                <TimerRow key={t.key} timer={t} clock={clock} lead={prefs.lead} />
              ))}
            </ul>
          )}
        </>
      )}

      <div className="timers__prefs">
        {TIMER_KINDS.map((k) => (
          <label key={k.id} className="checkbox">
            <input type="checkbox" checked={isTimerOn(prefs, k.id)} onChange={() => toggle(k.id)} />
            {k.label}
          </label>
        ))}
      </div>
      <div className="timers__prefs">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={prefs.voice}
            onChange={(e) => {
              onPrefs({ ...prefs, voice: e.target.checked });
              if (e.target.checked) testVoice();
            }}
          />
          Voice warnings
        </label>
        <label className="checkbox">
          <select
            className="input input--inline"
            value={prefs.lead}
            onChange={(e) => onPrefs({ ...prefs, lead: Number(e.target.value) })}
          >
            {LEADS.map((s) => (
              <option key={s} value={s}>
                {s}s
              </option>
            ))}
          </select>
          before
        </label>
      </div>
    </section>
  );
}

function TimerRow({ timer, clock, lead }: { timer: TimerEvent; clock: number; lead: number }) {
  const left = timer.at - clock;
  const soon = left <= lead;
  const title = timer.verified
    ? "Checked against game data"
    : "From community guides; may be off after a patch";
  return (
    <li className={`timers__row ${soon ? "timers__row--soon" : ""}`} title={title}>
      <span className="timers__left">
        {timer.approx ? "≈" : ""}
        {left > 0 ? formatDuration(left) : "now"}
      </span>
      <span>
        {timer.label}
        {!timer.verified && <span className="muted"> ?</span>}
      </span>
      <span className="muted timers__at">
        {formatClock(timer.at)}
        {timer.approx ? ` ±${timer.approx / 60}m` : ""}
      </span>
    </li>
  );
}
