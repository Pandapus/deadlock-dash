import { useEffect, useState } from "react";
import { searchSteamProfiles } from "../api/client";
import { dbStatus, setContribute, type DbStatus, type Environment } from "../api/native";
import type { SteamProfile } from "../api/types";
import type { Settings } from "../hooks/useSettings";
import { parseAccountId } from "../lib/steamId";

interface Props {
  settings: Settings;
  env: Environment | null;
  onSave: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, env, onSave, onClose }: Props) {
  const [accountInput, setAccountInput] = useState(settings.accountId?.toString() ?? "");
  const [logPath, setLogPath] = useState(settings.consoleLogPath ?? "");
  const [results, setResults] = useState<SteamProfile[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [db, setDb] = useState<DbStatus | null>(null);
  const [contribute, setContributeInput] = useState(true);

  useEffect(() => {
    dbStatus()
      .then((s) => {
        setDb(s);
        setContributeInput(s.contribute);
      })
      .catch((e) => console.error("Database status failed", e));
  }, []);

  const save = (accountId: number | null) => {
    onSave({ accountId, consoleLogPath: logPath.trim() || null });
    if (db && contribute !== db.contribute) {
      setContribute(contribute).catch((e) => console.error("Couldn't save sharing setting", e));
    }
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountInput.trim()) return save(null);
    const parsed = parseAccountId(accountInput);
    if (parsed !== null) return save(parsed);
    // Not an ID: treat it as a Steam name and search.
    setMessage("Searching…");
    try {
      const found = await searchSteamProfiles(accountInput.trim());
      setResults(found);
      setMessage(found.length ? "Pick your profile:" : "No profiles found.");
    } catch (err) {
      setMessage(`Search failed: ${err}`);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Settings</h2>

        <label className="field">
          <span>Steam account</span>
          <input
            className="input"
            value={accountInput}
            onChange={(e) => setAccountInput(e.target.value)}
            placeholder="Account ID, SteamID64, profile URL or Steam name"
          />
          {env?.account && (
            <button
              type="button"
              className="link"
              onClick={() => setAccountInput(String(env.account!.account_id))}
            >
              Use logged-in Steam account ({env.account.persona_name ?? env.account.account_id})
            </button>
          )}
        </label>
        {message && <p className="muted">{message}</p>}
        {results && results.length > 0 && (
          <ul className="search-results">
            {results.map((p) => (
              <li key={p.account_id}>
                <button type="button" onClick={() => save(p.account_id)}>
                  <img src={p.avatar} alt="" /> {p.personaname} <span className="muted">#{p.account_id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="field">
          <span>console.log path</span>
          <input
            className="input"
            value={logPath}
            onChange={(e) => setLogPath(e.target.value)}
            placeholder={env?.console_log_path ?? "…\\steamapps\\common\\Deadlock\\game\\citadel\\console.log"}
          />
          <small className="muted">
            Leave empty to use the detected path. The game only writes this file when launched with{" "}
            <code>-condebug</code>.
          </small>
        </label>

        <div className="field">
          <span>Match data</span>
          <label className="checkbox">
            <input type="checkbox" checked={contribute} onChange={(e) => setContributeInput(e.target.checked)} />
            Contribute my matches to community stats
          </label>
          <small className="muted">
            Matches are always saved on this PC. Cloud sync isn't built yet, so nothing is uploaded today. When it is,
            this setting decides whether your saved matches are shared.
          </small>
          {db && (
            <small className="muted">
              {db.error
                ? `Database couldn't be opened (${db.error}), so nothing is being saved.`
                : `${db.matches} matches and ${db.players} players saved in ${db.path}`}
            </small>
          )}
        </div>

        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
