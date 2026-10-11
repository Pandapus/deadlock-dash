//! Locates the Steam install, the Deadlock install and the most recently
//! logged-in Steam account by reading Steam's own config files. Nothing here
//! touches the game process.

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

/// SteamID64 = account_id (SteamID3) + this offset.
pub const STEAMID64_OFFSET: u64 = 76_561_197_960_265_728;

/// Folder name of Deadlock under `steamapps/common`.
const DEADLOCK_DIR: &str = "Deadlock";

/// Where the game writes its console output when launched with `-condebug`.
const CONSOLE_LOG_RELATIVE: &[&str] = &["game", "citadel", "console.log"];

#[derive(Debug, Clone, Serialize)]
pub struct SteamAccount {
    pub account_id: u32,
    /// String because SteamID64s exceed JavaScript's safe integer range.
    pub steam_id64: String,
    pub persona_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Environment {
    pub steam_root: Option<PathBuf>,
    pub deadlock_dir: Option<PathBuf>,
    pub console_log_path: Option<PathBuf>,
    pub console_log_exists: bool,
    pub account: Option<SteamAccount>,
}

pub fn detect() -> Environment {
    let steam_root = steam_root();
    let deadlock_dir = steam_root.as_deref().and_then(find_deadlock);
    let console_log_path = deadlock_dir.as_deref().map(console_log_path);
    let console_log_exists = console_log_path.as_deref().is_some_and(Path::is_file);
    let account = steam_root.as_deref().and_then(most_recent_account);
    Environment {
        steam_root,
        deadlock_dir,
        console_log_path,
        console_log_exists,
        account,
    }
}

pub fn console_log_path(deadlock_dir: &Path) -> PathBuf {
    CONSOLE_LOG_RELATIVE
        .iter()
        .fold(deadlock_dir.to_path_buf(), |p, part| p.join(part))
}

fn steam_root() -> Option<PathBuf> {
    steam_root_candidates().into_iter().find(|p| p.is_dir())
}

#[cfg(windows)]
fn steam_root_candidates() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut candidates = Vec::new();
    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam") {
        if let Ok(path) = key.get_value::<String, _>("SteamPath") {
            candidates.push(PathBuf::from(path));
        }
    }
    if let Ok(key) =
        RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\WOW6432Node\Valve\Steam")
    {
        if let Ok(path) = key.get_value::<String, _>("InstallPath") {
            candidates.push(PathBuf::from(path));
        }
    }
    candidates.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
    candidates
}

#[cfg(not(windows))]
fn steam_root_candidates() -> Vec<PathBuf> {
    // Linux (Proton) and macOS layouts, for development and the odd Linux player.
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    vec![
        home.join(".steam/steam"),
        home.join(".local/share/Steam"),
        home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
        home.join("Library/Application Support/Steam"),
    ]
}

fn find_deadlock(steam_root: &Path) -> Option<PathBuf> {
    let mut libraries = vec![steam_root.to_path_buf()];
    let vdf = steam_root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(text) = std::fs::read_to_string(vdf) {
        libraries.extend(parse_library_folders(&text));
    }
    libraries
        .into_iter()
        .map(|lib| lib.join("steamapps").join("common").join(DEADLOCK_DIR))
        .find(|p| p.is_dir())
}

/// Extracts every `"path"` value from `steamapps/libraryfolders.vdf`.
fn parse_library_folders(vdf: &str) -> Vec<PathBuf> {
    static PATH_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#""path"\s+"((?:[^"\\]|\\.)*)""#).unwrap());
    PATH_RE
        .captures_iter(vdf)
        .map(|c| PathBuf::from(unescape_vdf(&c[1])))
        .collect()
}

fn unescape_vdf(s: &str) -> String {
    s.replace(r"\\", r"\").replace(r#"\""#, "\"")
}

fn most_recent_account(steam_root: &Path) -> Option<SteamAccount> {
    let text = std::fs::read_to_string(steam_root.join("config").join("loginusers.vdf")).ok()?;
    parse_login_users(&text)
}

/// Picks the account marked `"MostRecent" "1"` in `config/loginusers.vdf`,
/// falling back to the first account listed.
fn parse_login_users(vdf: &str) -> Option<SteamAccount> {
    static USER_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#""(\d{17})"\s*\{([^}]*)\}"#).unwrap());
    static MOST_RECENT_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?i)"MostRecent"\s+"1""#).unwrap());
    static PERSONA_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?i)"PersonaName"\s+"((?:[^"\\]|\\.)*)""#).unwrap());

    let users: Vec<(u64, &str)> = USER_RE
        .captures_iter(vdf)
        .filter_map(|c| {
            let id = c[1].parse().ok()?;
            Some((id, c.get(2)?.as_str()))
        })
        .collect();
    let (steam_id64, body) = users
        .iter()
        .find(|(_, body)| MOST_RECENT_RE.is_match(body))
        .or_else(|| users.first())
        .copied()?;
    Some(SteamAccount {
        account_id: account_id_from_steam_id64(steam_id64)?,
        steam_id64: steam_id64.to_string(),
        persona_name: PERSONA_RE.captures(body).map(|c| unescape_vdf(&c[1])),
    })
}

pub fn account_id_from_steam_id64(steam_id64: u64) -> Option<u32> {
    steam_id64
        .checked_sub(STEAMID64_OFFSET)
        .and_then(|id| u32::try_from(id).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_library_folders() {
        let vdf = r#"
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps" { "228980" "0" }
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}"#;
        assert_eq!(
            parse_library_folders(vdf),
            vec![
                PathBuf::from(r"C:\Program Files (x86)\Steam"),
                PathBuf::from(r"D:\SteamLibrary"),
            ]
        );
    }

    #[test]
    fn picks_most_recent_login_user() {
        let vdf = r#"
"users"
{
	"76561197960265729"
	{
		"AccountName"		"old"
		"PersonaName"		"Old Account"
		"MostRecent"		"0"
	}
	"76561198000000000"
	{
		"AccountName"		"main"
		"PersonaName"		"Main \"Quoted\" Account"
		"MostRecent"		"1"
	}
}"#;
        let account = parse_login_users(vdf).unwrap();
        assert_eq!(account.steam_id64, "76561198000000000");
        assert_eq!(account.account_id, 39_734_272);
        assert_eq!(
            account.persona_name.as_deref(),
            Some(r#"Main "Quoted" Account"#)
        );
    }

    #[test]
    fn falls_back_to_first_login_user() {
        let vdf = r#""users" { "76561197960265729" { "PersonaName" "Solo" } }"#;
        assert_eq!(parse_login_users(vdf).unwrap().account_id, 1);
    }

    #[test]
    fn rejects_non_individual_steam_ids() {
        assert_eq!(account_id_from_steam_id64(42), None);
    }
}
