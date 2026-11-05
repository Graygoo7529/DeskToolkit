//! Shared HTTP client construction for all APIConfig network operations.
//!
//! The proxy is an application-level setting.  Keeping client construction in
//! one place makes the Codex, Claude and API Probe paths obey the same switch.
use reqwest::{Client, Proxy};
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const DEFAULT_PROXY_URL: &str = "http://127.0.0.1:7897";

fn default_enabled() -> bool {
    true
}

fn default_proxy_url() -> String {
    DEFAULT_PROXY_URL.into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct ProxySettings {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_proxy_url")]
    pub https_proxy: String,
    /// Kept for compatibility with environments which use the historical
    /// `https_proxys` variable name. Both values are used as fallbacks.
    #[serde(default = "default_proxy_url")]
    pub https_proxys: String,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            https_proxy: DEFAULT_PROXY_URL.into(),
            https_proxys: DEFAULT_PROXY_URL.into(),
        }
    }
}

impl ProxySettings {
    #[cfg(test)]
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ..Self::default()
        }
    }

    pub fn effective_url(&self) -> Option<&str> {
        if !self.enabled {
            return None;
        }
        let primary = self.https_proxy.trim();
        if !primary.is_empty() {
            Some(primary)
        } else {
            let fallback = self.https_proxys.trim();
            (!fallback.is_empty()).then_some(fallback)
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        for (name, value) in [
            ("https_proxy", self.https_proxy.trim()),
            ("https_proxys", self.https_proxys.trim()),
        ] {
            if value.is_empty() {
                continue;
            }
            let url = reqwest::Url::parse(value)
                .map_err(|_| format!("{name} 必须是有效的 HTTP(S) 代理地址"))?;
            if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
                return Err(format!("{name} 必须是有效的 HTTP(S) 代理地址"));
            }
        }
        if self.enabled && self.effective_url().is_none() {
            return Err("已开启地区代理，但没有配置代理地址".into());
        }
        Ok(())
    }
}

pub fn client(settings: &ProxySettings, user_agent: &'static str) -> Result<Client, String> {
    settings.validate()?;
    let mut builder = Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none());
    if let Some(url) = settings.effective_url() {
        builder = builder
            .proxy(Proxy::all(url).map_err(|_| "代理地址无效，无法创建网络连接".to_string())?);
    }
    builder
        .build()
        .map_err(|_| "无法创建网络连接，请检查代理设置".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_enable_both_proxy_names() {
        let settings = ProxySettings::default();
        assert!(settings.enabled);
        assert_eq!(settings.https_proxy, DEFAULT_PROXY_URL);
        assert_eq!(settings.https_proxys, DEFAULT_PROXY_URL);
    }

    #[test]
    fn disabled_proxy_does_not_require_an_address() {
        let settings = ProxySettings {
            enabled: false,
            https_proxy: String::new(),
            https_proxys: String::new(),
        };
        assert!(settings.validate().is_ok());
        assert!(settings.effective_url().is_none());
    }

    #[test]
    fn malformed_proxy_address_is_rejected() {
        let settings = ProxySettings {
            enabled: false,
            https_proxy: "not a url".into(),
            https_proxys: String::new(),
        };
        assert!(settings.validate().is_err());
    }
}
