use crate::otp::{self, Algorithm};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

const MAX_FILE: u64 = 16 * 1024 * 1024;
pub const VAULT: &str = "accounts.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryCode {
    pub id: String,
    pub code: String,
    pub used: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub issuer: String,
    pub account: String,
    pub secret: String,
    pub algorithm: Algorithm,
    pub digits: u32,
    pub period: u64,
    pub group: String,
    pub color: String,
    pub favorite: bool,
    pub notes: String,
    pub recovery_codes: Vec<RecoveryCode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountInput {
    pub id: Option<String>,
    pub issuer: String,
    pub account: String,
    pub secret: Option<String>,
    pub algorithm: Algorithm,
    pub digits: u32,
    pub period: u64,
    pub group: String,
    pub color: String,
    pub notes: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String,
    pub issuer: String,
    pub account: String,
    pub algorithm: Algorithm,
    pub digits: u32,
    pub period: u64,
    pub group: String,
    pub color: String,
    pub favorite: bool,
    pub notes: String,
    pub recovery_total: usize,
    pub recovery_remaining: usize,
}
impl From<&Account> for AccountSummary {
    fn from(a: &Account) -> Self {
        Self {
            id: a.id.clone(),
            issuer: a.issuer.clone(),
            account: a.account.clone(),
            algorithm: a.algorithm,
            digits: a.digits,
            period: a.period,
            group: a.group.clone(),
            color: a.color.clone(),
            favorite: a.favorite,
            notes: a.notes.clone(),
            recovery_total: a.recovery_codes.len(),
            recovery_remaining: a.recovery_codes.iter().filter(|c| !c.used).count(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Vault {
    pub format: String,
    pub version: u32,
    pub accounts: Vec<Account>,
}
impl Default for Vault {
    fn default() -> Self {
        Self {
            format: "2FAuth".into(),
            version: 1,
            accounts: vec![],
        }
    }
}
impl Vault {
    fn validate(&mut self) -> Result<(), String> {
        if self.format != "2FAuth" || self.version != 1 {
            return Err("不支持的数据格式或版本，需要 2FAuth v1 备份".into());
        }
        if self.accounts.len() > 2000 {
            return Err("最多支持 2000 个账户".into());
        }
        let mut ids = HashSet::new();
        for a in &mut self.accounts {
            validate_account(a)?;
            if !ids.insert(a.id.clone()) {
                return Err("数据包含重复账户 ID".into());
            }
        }
        Ok(())
    }
}
fn validate_account(a: &mut Account) -> Result<(), String> {
    if Uuid::parse_str(&a.id).is_err() {
        return Err("账户 ID 无效".into());
    }
    a.issuer = a.issuer.trim().to_owned();
    a.account = a.account.trim().to_owned();
    a.group = a.group.trim().to_owned();
    if a.issuer.is_empty() || a.account.is_empty() || a.issuer.len() > 240 || a.account.len() > 320
    {
        return Err("请填写平台与账户名称（不超过 240 / 320 字节）".into());
    }
    if a.group.len() > 120 || a.notes.len() > 10000 {
        return Err("分组或备注过长".into());
    }
    if a.color.len() != 7
        || !a.color.starts_with('#')
        || !a.color[1..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("账户颜色无效".into());
    }
    a.secret = otp::normalize_secret(&a.secret)?;
    otp::validate_params(a.digits, a.period)?;
    if a.recovery_codes.len() > 200 {
        return Err("每个账户最多保存 200 个恢复码".into());
    }
    let mut ids = HashSet::new();
    let mut codes = HashSet::new();
    for c in &a.recovery_codes {
        if Uuid::parse_str(&c.id).is_err()
            || c.code.trim().is_empty()
            || c.code.len() > 512
            || c.code.contains(['\r', '\n'])
            || !ids.insert(&c.id)
            || !codes.insert(&c.code)
        {
            return Err("恢复码包含无效值或重复内容".into());
        }
    }
    Ok(())
}

pub fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|_| "无法读取文件，请检查路径和权限")?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取文件失败")?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("文件超过 16 MB 限制".into());
    }
    Ok(bytes)
}
fn decode(bytes: &[u8]) -> Result<Vault, String> {
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    let mut vault: Vault = serde_json::from_slice(bytes)
        .map_err(|_| "数据文件格式错误；原文件已保留，请检查文件或使用备份")?;
    vault.validate()?;
    Ok(vault)
}
pub fn atomic_write(path: &Path, bytes: &[u8], replace: bool) -> Result<(), String> {
    let parent = path.parent().ok_or("文件路径无效")?;
    let mut temp =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建临时文件，请检查目录权限")?;
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "写入文件失败（可能磁盘空间不足）")?;
    if replace {
        temp.persist(path)
    } else {
        temp.persist_noclobber(path)
    }
    .map_err(|_| "无法保存文件；文件可能已存在或正被占用")?;
    Ok(())
}

pub struct Store {
    pub config_path: PathBuf,
    pub dir: Option<PathBuf>,
    pub vault: Vault,
    raw: Vec<u8>,
    directory_lock: Option<File>,
    pub startup_error: Option<String>,
}
impl Store {
    pub fn new(config_path: PathBuf) -> Self {
        let mut store = Self {
            config_path,
            dir: None,
            vault: Vault::default(),
            raw: vec![],
            directory_lock: None,
            startup_error: None,
        };
        if store.config_path.exists() {
            let result = (|| {
                let value: serde_json::Value =
                    serde_json::from_slice(&read_limited(&store.config_path)?)
                        .map_err(|_| "目录指针文件损坏")?;
                let dir = value
                    .get("dataDir")
                    .and_then(|v| v.as_str())
                    .ok_or("目录指针无效")?;
                if !Path::new(dir).join(VAULT).is_file() {
                    return Err("原数据目录不可用；请重新连接目录。不会自动创建空账户库".into());
                }
                store.open(Path::new(dir))
            })();
            if let Err(e) = result {
                store.startup_error = Some(e);
            }
        }
        store
    }
    pub fn open(&mut self, path: &Path) -> Result<(), String> {
        if !path.is_absolute() {
            return Err("请选择绝对路径".into());
        }
        fs::create_dir_all(path).map_err(|_| "无法创建数据目录")?;
        let dir = fs::canonicalize(path).map_err(|_| "无法访问数据目录")?;
        let same = self.dir.as_ref() == Some(&dir);
        let vault_path = dir.join(VAULT);
        let exists = vault_path.exists();
        if !exists {
            let entries = fs::read_dir(&dir).map_err(|_| "无法读取数据目录")?;
            for entry in entries {
                let entry = entry.map_err(|_| "无法读取数据目录")?;
                if entry.file_name() != ".2fauth.lock" {
                    return Err("请选择空目录或包含有效 accounts.json 的 2FAuth 目录".into());
                }
            }
        }
        let directory_lock = if same {
            None
        } else {
            let lock = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(dir.join(".2fauth.lock"))
                .map_err(|_| "无法锁定数据目录")?;
            lock.try_lock_exclusive()
                .map_err(|_| "该数据目录已被另一个 2FAuth 窗口使用，请先关闭它")?;
            Some(lock)
        };
        let (vault, raw) = if exists {
            let raw = read_limited(&vault_path)?;
            (decode(&raw)?, raw)
        } else {
            let vault = Vault::default();
            let raw = serde_json::to_vec_pretty(&vault).map_err(|_| "初始化失败")?;
            atomic_write(&vault_path, &raw, false)?;
            (vault, raw)
        };
        let parent = self.config_path.parent().ok_or("配置目录无效")?;
        fs::create_dir_all(parent).map_err(|_| "无法创建配置目录")?;
        let pointer =
            serde_json::to_vec_pretty(&serde_json::json!({"dataDir": display_path(&dir)}))
                .map_err(|_| "保存目录失败")?;
        atomic_write(&self.config_path, &pointer, true)?;
        if !same {
            self.directory_lock = directory_lock;
        }
        self.dir = Some(dir);
        self.vault = vault;
        self.raw = raw;
        self.startup_error = None;
        Ok(())
    }
    pub fn account(&self, id: &str) -> Result<&Account, String> {
        self.vault
            .accounts
            .iter()
            .find(|a| a.id == id)
            .ok_or_else(|| "账户不存在，请刷新列表".into())
    }
    fn commit(&mut self, mut next: Vault) -> Result<(), String> {
        let dir = self.dir.as_ref().ok_or("请先选择数据目录")?;
        next.validate()?;
        if read_limited(&dir.join(VAULT))? != self.raw {
            return Err("数据文件已被外部修改，请在数据管理中重新连接目录后重试".into());
        }
        let raw = serde_json::to_vec_pretty(&next).map_err(|_| "无法序列化账户")?;
        if raw.len() as u64 > MAX_FILE {
            return Err("账户数据超过 16 MB 限制".into());
        }
        // Back up the last valid state before atomically replacing the live file.
        atomic_write(&dir.join("accounts.previous.json"), &self.raw, true)?;
        atomic_write(&dir.join(VAULT), &raw, true)?;
        self.vault = next;
        self.raw = raw;
        Ok(())
    }
    pub fn save(&mut self, input: AccountInput) -> Result<String, String> {
        let old = input.id.as_deref().map(|id| self.account(id)).transpose()?;
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let mut account = Account {
            id: id.clone(),
            issuer: input.issuer,
            account: input.account,
            secret: input
                .secret
                .filter(|v| !v.trim().is_empty())
                .or_else(|| old.map(|a| a.secret.clone()))
                .ok_or("请填写共享密钥")?,
            algorithm: input.algorithm,
            digits: input.digits,
            period: input.period,
            group: input.group,
            color: input.color,
            notes: input.notes,
            favorite: old.is_some_and(|a| a.favorite),
            recovery_codes: old.map(|a| a.recovery_codes.clone()).unwrap_or_default(),
        };
        validate_account(&mut account)?;
        if self.vault.accounts.iter().any(|a| {
            a.id != id
                && a.secret == account.secret
                && a.algorithm == account.algorithm
                && a.digits == account.digits
                && a.period == account.period
        }) {
            return Err("已存在使用相同密钥和参数的账户".into());
        }
        let mut next = self.vault.clone();
        if let Some(existing) = next.accounts.iter_mut().find(|a| a.id == id) {
            *existing = account;
        } else {
            next.accounts.push(account);
        }
        self.commit(next)?;
        Ok(id)
    }
    pub fn update(&mut self, id: &str, f: impl FnOnce(&mut Account)) -> Result<(), String> {
        let mut next = self.vault.clone();
        let a = next
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or("账户不存在")?;
        f(a);
        self.commit(next)
    }
    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        self.account(id)?;
        let mut next = self.vault.clone();
        next.accounts.retain(|a| a.id != id);
        self.commit(next)
    }
    pub fn recovery(&mut self, id: &str, text: &str) -> Result<(), String> {
        if text.len() > 110000 {
            return Err("恢复码内容过长".into());
        }
        let old = &self.account(id)?.recovery_codes;
        let mut unique = HashSet::new();
        let codes = text
            .lines()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .filter(|s| unique.insert(*s))
            .map(|code| {
                old.iter()
                    .find(|c| c.code == code)
                    .cloned()
                    .unwrap_or_else(|| RecoveryCode {
                        id: Uuid::new_v4().to_string(),
                        code: code.into(),
                        used: false,
                    })
            })
            .collect();
        self.update(id, |a| a.recovery_codes = codes)
    }
    pub fn set_recovery_used(&mut self, id: &str, code_id: &str, used: bool) -> Result<(), String> {
        if !self
            .account(id)?
            .recovery_codes
            .iter()
            .any(|c| c.id == code_id)
        {
            return Err("恢复码不存在".into());
        }
        self.update(id, |a| {
            if let Some(c) = a.recovery_codes.iter_mut().find(|c| c.id == code_id) {
                c.used = used;
            }
        })
    }
    pub fn import(&mut self, path: &Path) -> Result<(usize, usize), String> {
        let imported = decode(&read_limited(path)?)?;
        let mut next = self.vault.clone();
        let mut added = 0;
        let mut skipped = 0;
        for mut a in imported.accounts {
            // Existing accounts (including recovery usage) always win during a merge.
            if next.accounts.iter().any(|b| {
                b.id == a.id
                    || (b.secret == a.secret
                        && b.algorithm == a.algorithm
                        && b.digits == a.digits
                        && b.period == a.period)
            }) {
                skipped += 1;
                continue;
            }
            a.id = Uuid::new_v4().to_string();
            next.accounts.push(a);
            added += 1;
        }
        if added > 0 {
            self.commit(next)?;
        }
        Ok((added, skipped))
    }
    pub fn export(&self, path: &Path) -> Result<(), String> {
        if self.dir.is_none() {
            return Err("请先选择数据目录".into());
        }
        if !path.is_absolute() {
            return Err("备份路径必须是绝对路径".into());
        }
        if path.file_name().is_some_and(|s| {
            [
                "accounts.json",
                "accounts.previous.json",
                "storage.json",
                ".2fauth.lock",
            ]
            .iter()
            .any(|n| s.to_string_lossy().eq_ignore_ascii_case(n))
        }) {
            return Err("请使用独立的备份文件名，例如 2fauth-backup.json".into());
        }
        atomic_write(
            path,
            &serde_json::to_vec_pretty(&self.vault).map_err(|_| "备份序列化失败")?,
            false,
        )
    }
}
pub fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> AccountInput {
        AccountInput {
            id: None,
            issuer: "GitHub".into(),
            account: "alice".into(),
            secret: Some("JBSWY3DPEHPK3PXP".into()),
            algorithm: Algorithm::SHA1,
            digits: 6,
            period: 30,
            group: "个人".into(),
            color: "#A7B8EF".into(),
            notes: String::new(),
        }
    }
    fn setup(root: &Path) -> Store {
        let mut store = Store::new(root.join("config/storage.json"));
        store.open(&root.join("data")).unwrap();
        store
    }
    #[test]
    fn persistence_recovery_and_secret_redaction() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        s.recovery(&id, "first-code\nsecond-code\nfirst-code")
            .unwrap();
        let rid = s.account(&id).unwrap().recovery_codes[0].id.clone();
        s.set_recovery_used(&id, &rid, true).unwrap();
        s.recovery(&id, "first-code\nsecond-code\nthird-code")
            .unwrap();
        assert!(s.account(&id).unwrap().recovery_codes[0].used);
        let mut edit = input();
        edit.id = Some(id.clone());
        edit.secret = None;
        edit.account = "bob".into();
        s.save(edit).unwrap();
        let json = serde_json::to_string(&AccountSummary::from(s.account(&id).unwrap())).unwrap();
        assert!(!json.contains("JBSWY3"));
        assert!(!json.contains("first-code"));
        assert!(root.path().join("data/accounts.previous.json").exists());
        drop(s);
        let restored = Store::new(root.path().join("config/storage.json"));
        assert!(restored.startup_error.is_none());
        assert_eq!(restored.account(&id).unwrap().account, "bob");
        assert_eq!(restored.account(&id).unwrap().recovery_codes.len(), 3);
    }
    #[test]
    fn corrupt_external_changes_and_directory_switch_are_safe() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        s.save(input()).unwrap();
        let before = s.raw.clone();
        let mut invalid = input();
        invalid.period = 0;
        assert!(s.save(invalid).is_err());
        assert_eq!(s.raw, before);
        let dirty = root.path().join("dirty");
        fs::create_dir(&dirty).unwrap();
        fs::write(dirty.join("notes.txt"), "keep").unwrap();
        assert!(s.open(&dirty).is_err());
        assert_eq!(s.vault.accounts.len(), 1);
        fs::write(root.path().join("data/accounts.json"), "corrupt").unwrap();
        let id = s.vault.accounts[0].id.clone();
        assert!(s.delete(&id).is_err());
        assert_eq!(s.vault.accounts.len(), 1);
        assert_eq!(
            fs::read_to_string(root.path().join("data/accounts.json")).unwrap(),
            "corrupt"
        );
        drop(s);
        let restored = Store::new(root.path().join("config/storage.json"));
        assert!(restored.startup_error.is_some());
        assert!(restored.dir.is_none());
    }
    #[test]
    fn directory_lock_and_backup_merge() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        let mut second = Store::new(root.path().join("other/storage.json"));
        assert!(second.open(&root.path().join("data")).is_err());
        s.recovery(&id, "recovery-one").unwrap();
        let backup = root.path().join("backup.json");
        s.export(&backup).unwrap();
        assert!(s.export(&backup).is_err());
        let rid = s.account(&id).unwrap().recovery_codes[0].id.clone();
        s.set_recovery_used(&id, &rid, true).unwrap();
        assert_eq!(s.import(&backup).unwrap(), (0, 1));
        assert!(s.account(&id).unwrap().recovery_codes[0].used);
        second.open(&root.path().join("new-data")).unwrap();
        assert_eq!(second.import(&backup).unwrap(), (1, 0));
        assert_eq!(second.import(&backup).unwrap(), (0, 1));
        let invalid = root.path().join("bad.json");
        fs::write(
            &invalid,
            "{\"format\":\"2FAuth\",\"version\":999,\"accounts\":[]}",
        )
        .unwrap();
        assert!(second.import(&invalid).is_err());
        assert_eq!(second.vault.accounts.len(), 1);
    }
}
