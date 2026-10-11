//! Thin proxy to the community deadlock-api.com REST API. Requests go through
//! Rust so the webview needs no CORS exceptions and an optional API key never
//! reaches frontend code.

use std::time::Duration;

use reqwest::Client;
use serde_json::Value;

const BASE_URL: &str = "https://api.deadlock-api.com";
const USER_AGENT: &str = concat!("deadlock-dash/", env!("CARGO_PKG_VERSION"));
/// Optional key from https://deadlock-api.com; raises some rate limits.
const API_KEY_ENV: &str = "DEADLOCK_API_KEY";

pub struct DeadlockApi {
    client: Client,
    api_key: Option<String>,
}

impl DeadlockApi {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(15))
            .build()
            .expect("failed to build HTTP client");
        let api_key = std::env::var(API_KEY_ENV).ok().filter(|k| !k.is_empty());
        Self { client, api_key }
    }

    pub async fn get(&self, path: &str, query: &[(String, String)]) -> Result<Value, String> {
        validate_path(path)?;
        let mut request = self.client.get(format!("{BASE_URL}{path}")).query(query);
        if let Some(key) = &self.api_key {
            request = request.header("X-API-KEY", key);
        }
        let response = request.send().await.map_err(|e| e.to_string())?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "{status}: {}",
                body.chars().take(300).collect::<String>()
            ));
        }
        response.json().await.map_err(|e| e.to_string())
    }
}

/// Only allow versioned API paths on the fixed host.
fn validate_path(path: &str) -> Result<(), String> {
    let ok = (path.starts_with("/v1/") || path.starts_with("/v2/"))
        && !path.contains("..")
        && !path.contains('?')
        && !path.contains('#')
        && !path.contains("//");
    if ok {
        Ok(())
    } else {
        Err(format!("invalid API path: {path}"))
    }
}

#[cfg(test)]
mod tests {
    use super::validate_path;

    #[test]
    fn validates_paths() {
        assert!(validate_path("/v1/players/123/match-history").is_ok());
        assert!(validate_path("/v2/patches").is_ok());
        assert!(validate_path("/v1/../admin").is_err());
        assert!(validate_path("//evil.example/v1/").is_err());
        assert!(validate_path("/v1/x?y=1").is_err());
        assert!(validate_path("v1/players").is_err());
    }
}
