//! 读写 repo 根的 `deskbot.local.json`（gitignored，含 apiKey——严禁输出到日志）。
//! 契约见 docs/architecture.md §3。

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
pub struct PetPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub api_key: Option<String>,
    pub base_url: String,
    pub kimi_path: String,
    pub workspace_dir: String,
    pub session_id: Option<String>,
    pub pet_position: Option<PetPosition>,
    pub pet_visible: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_key: None,
            base_url: "https://api.kimi.com/coding/v1".into(),
            kimi_path: "kimi".into(),
            workspace_dir: "workspace".into(),
            session_id: None,
            pet_position: None,
            pet_visible: true,
        }
    }
}

pub struct ConfigStore {
    root: PathBuf,
    path: PathBuf,
    inner: RwLock<Config>,
}

impl ConfigStore {
    pub fn load() -> Self {
        let root = find_root();
        let path = root.join("deskbot.local.json");
        let cfg = match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str::<Config>(&text).unwrap_or_else(|e| {
                eprintln!("[deskbot][config] 解析失败，回退默认配置: {e}");
                Config::default()
            }),
            Err(_) => Config::default(),
        };
        Self {
            root,
            path,
            inner: RwLock::new(cfg),
        }
    }

    pub fn get(&self) -> Config {
        self.inner.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// 修改配置并立即落盘。
    pub fn update(&self, f: impl FnOnce(&mut Config)) {
        {
            let mut cfg = self.inner.write().unwrap_or_else(|e| e.into_inner());
            f(&mut cfg);
        }
        self.save();
    }

    fn save(&self) {
        let cfg = self.inner.read().unwrap_or_else(|e| e.into_inner());
        match serde_json::to_string_pretty(&*cfg) {
            Ok(text) => {
                if let Err(e) = std::fs::write(&self.path, text) {
                    eprintln!("[deskbot][config] 写入失败: {e}");
                }
            }
            Err(e) => eprintln!("[deskbot][config] 序列化失败: {e}"),
        }
    }

    /// workspace 目录（kimi 的 cwd）的绝对路径。
    pub fn workspace_abs(&self) -> PathBuf {
        let cfg = self.get();
        let p = PathBuf::from(&cfg.workspace_dir);
        if p.is_absolute() {
            p
        } else {
            self.root.join(p)
        }
    }
}

/// 定位 repo 根：`DESKBOT_ROOT` 环境变量优先，否则从 current_exe 向上找
/// 含 `deskbot.local.json` 或 `src-tauri/` 的目录（dev 下 cwd 是 src-tauri/，不能依赖 cwd）。
fn find_root() -> PathBuf {
    if let Ok(root) = std::env::var("DESKBOT_ROOT") {
        let p = PathBuf::from(root);
        if p.is_dir() {
            return p;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        for dir in exe.ancestors().skip(1) {
            if dir.join("deskbot.local.json").is_file() || dir.join("src-tauri").is_dir() {
                return dir.to_path_buf();
            }
        }
    }
    std::env::current_dir().unwrap_or_else(|_| Path::new(".").to_path_buf())
}
