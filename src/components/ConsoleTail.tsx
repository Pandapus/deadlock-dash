import { useEffect, useRef, useState } from "react";
import type { ConsoleStatus } from "../api/native";

const SHOWN = 300;

/**
 * Raw view of console.log. Mostly a development aid: use it to find the lines
 * worth turning into events in src-tauri/src/console_log.rs.
 */
export function ConsoleTail({ lines, status }: { lines: string[]; status: ConsoleStatus | null }) {
  const [filter, setFilter] = useState("");
  const listRef = useRef<HTMLPreElement>(null);
  const needle = filter.trim().toLowerCase();
  const shown = (needle ? lines.filter((l) => l.toLowerCase().includes(needle)) : lines).slice(-SHOWN);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, lines]);

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Console log</h2>
        <input
          className="input input--small"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </header>
      {!status && (
        <p className="muted">Not watching yet. If Deadlock wasn't detected, set the console.log path in Settings.</p>
      )}
      {status?.state === "waiting" && (
        <p className="muted">
          Waiting for <code>{status.path}</code>. Add <code>-condebug</code> to Deadlock's launch options in Steam
          (Properties → General → Launch Options), then start the game.
        </p>
      )}
      {status?.state === "error" && <p className="error">{status.message}</p>}
      <pre className="console" ref={listRef}>
        {shown.length ? shown.join("\n") : <span className="muted">No output yet.</span>}
      </pre>
    </section>
  );
}
