use crate::model::{self, Account, AccountInput, Vault};
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;
const MAX_FILE: u64 = 16 * 1024 * 1024;
pub const VAULT: &str = "accounts.json";
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
    // Read legacy files without rewriting them. The next explicit save/export is v2.
    vault.version = 2;
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
                if entry.file_name() != ".deskauth.lock" {
                    return Err("请选择空目录或包含有效 accounts.json 的 DeskAuth 目录".into());
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
                .open(dir.join(".deskauth.lock"))
                .map_err(|_| "无法锁定数据目录")?;
            lock.try_lock_exclusive()
                .map_err(|_| "该数据目录已被另一个 DeskAuth 窗口使用，请先关闭它")?;
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
        let now = model::now_ms()?;
        let password = input
            .password
            .unwrap_or_else(|| old.map(|a| a.password.clone()).unwrap_or_default());
        let password_changed = old.is_none_or(|a| a.password != password);
        let mut account = Account {
            id: id.clone(),
            platform: input.platform,
            website: input.website,
            alias: input.alias,
            username: input.username,
            password,
            totp: old.and_then(|a| a.totp.clone()),
            phones: input.phones,
            emails: input.emails,
            group: input.group,
            tags: input.tags,
            color: input.color,
            notes: input.notes,
            favorite: old.is_some_and(|a| a.favorite),
            created_at: old.map(|a| a.created_at).unwrap_or(now),
            updated_at: now,
            password_updated_at: if password_changed {
                Some(now)
            } else {
                old.and_then(|a| a.password_updated_at)
            },
        };
        model::validate_account(&mut account)?;
        if self
            .vault
            .accounts
            .iter()
            .any(|a| a.id != id && model::same_identity(a, &account))
        {
            return Err(
                "已存在相同平台、网站、用户名和别名的账户；可编辑原记录或使用不同别名".into(),
            );
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
    pub fn favorite(&mut self, id: &str, value: bool) -> Result<(), String> {
        let mut next = self.vault.clone();
        let a = next
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or("账户不存在")?;
        a.favorite = value;
        a.updated_at = model::now_ms()?;
        self.commit(next)
    }
    pub fn configure_totp(
        &mut self,
        id: &str,
        input: crate::model::TotpInput,
    ) -> Result<(), String> {
        let old = self.account(id)?;
        let secret = match input.secret {
            Some(value) if !value.trim().is_empty() => value,
            _ => old
                .totp
                .as_ref()
                .map(|t| t.secret.clone())
                .ok_or("请填写认证器共享密钥")?,
        };
        let mut next = self.vault.clone();
        let a = next
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or("账户不存在")?;
        a.totp = Some(crate::model::Totp {
            secret,
            algorithm: input.algorithm,
            digits: input.digits,
            period: input.period,
        });
        a.updated_at = model::now_ms()?;
        self.commit(next)
    }
    pub fn remove_totp(&mut self, id: &str) -> Result<(), String> {
        self.account(id)?;
        let mut next = self.vault.clone();
        let a = next
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or("账户不存在")?;
        a.totp = None;
        a.updated_at = model::now_ms()?;
        self.commit(next)
    }
    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        self.account(id)?;
        let mut next = self.vault.clone();
        next.accounts.retain(|a| a.id != id);
        self.commit(next)
    }
    pub fn import(&mut self, path: &Path) -> Result<(usize, usize), String> {
        if self.dir.is_none() {
            return Err("请先选择数据目录".into());
        }
        let imported = decode(&read_limited(path)?)?;
        let mut next = self.vault.clone();
        let mut added = 0;
        let mut skipped = 0;
        for a in imported.accounts {
            // Retain stable IDs for repeatable imports. Existing records always win.
            if next
                .accounts
                .iter()
                .any(|b| b.id == a.id || model::same_identity(b, &a))
            {
                skipped += 1;
                continue;
            }
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
                ".deskauth.lock",
            ]
            .iter()
            .any(|n| s.to_string_lossy().eq_ignore_ascii_case(n))
        }) {
            return Err("请使用独立的备份文件名，例如 deskauth-backup.json".into());
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
    use crate::model::{AccountSummary, Contact, Purpose};
    fn contact(value: &str) -> Contact {
        Contact {
            id: Uuid::new_v4().to_string(),
            value: value.into(),
            label: "个人".into(),
            purposes: vec![Purpose::Login, Purpose::Recovery],
            primary: true,
            notes: "关联资料".into(),
        }
    }
    fn input() -> AccountInput {
        AccountInput {
            id: None,
            platform: "GitHub".into(),
            website: "https://github.com/".into(),
            alias: "个人账户".into(),
            username: "alice".into(),
            password: Some("  p@ss 中文  ".into()),
            phones: vec![contact("+86 138-0000-0000")],
            emails: vec![contact("Alice@example.com")],
            group: "开发".into(),
            tags: vec!["工作".into()],
            color: "#A7B8EF".into(),
            notes: "测试资料".into(),
        }
    }
    fn setup(root: &Path) -> Store {
        let mut s = Store::new(root.join("config/storage.json"));
        s.open(&root.join("data")).unwrap();
        s
    }
    fn totp_input(secret: Option<&str>) -> crate::model::TotpInput {
        crate::model::TotpInput {
            secret: secret.map(str::to_owned),
            algorithm: crate::otp::Algorithm::SHA1,
            digits: 6,
            period: 30,
        }
    }
    #[test]
    fn v1_upgrade_preserves_raw_file_until_save_and_keeps_totp_during_account_edits() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        let path = root.path().join("data/accounts.json");
        let mut old = serde_json::to_value(&s.vault).unwrap();
        old["version"] = 1.into();
        old["accounts"][0].as_object_mut().unwrap().remove("totp");
        let old_raw = serde_json::to_vec_pretty(&old).unwrap();
        drop(s);
        fs::write(&path, &old_raw).unwrap();
        let mut s = Store::new(root.path().join("config/storage.json"));
        assert!(s.startup_error.is_none());
        assert_eq!(s.vault.version, 2);
        assert_eq!(fs::read(&path).unwrap(), old_raw);
        s.configure_totp(&id, totp_input(Some("JBSWY3DPEHPK3PXP")))
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(&path).unwrap()).unwrap()
                ["version"],
            2
        );
        assert_eq!(
            fs::read(root.path().join("data/accounts.previous.json")).unwrap(),
            old_raw
        );
        let before = s.raw.clone();
        let mut invalid = totp_input(Some("invalid!"));
        invalid.period = 0;
        assert!(s.configure_totp(&id, invalid).is_err());
        assert_eq!(s.raw, before);
        let mut edit = input();
        edit.id = Some(id.clone());
        edit.password = None;
        edit.alias = "updated".into();
        s.save(edit).unwrap();
        assert_eq!(
            s.account(&id).unwrap().totp.as_ref().unwrap().secret,
            "JBSWY3DPEHPK3PXP"
        );
        let mut params = totp_input(None);
        params.digits = 8;
        params.period = 60;
        s.configure_totp(&id, params).unwrap();
        let summary =
            serde_json::to_string(&AccountSummary::from(s.account(&id).unwrap())).unwrap();
        assert!(!summary.contains("JBSWY"));
        assert!(!summary.contains("p@ss"));
        assert!(summary.contains("60"));
        s.remove_totp(&id).unwrap();
        let a = s.account(&id).unwrap();
        assert!(a.totp.is_none());
        assert_eq!(a.password, "  p@ss 中文  ");
        assert_eq!(a.phones.len(), 1);
        assert_eq!(a.emails.len(), 1);
        assert_eq!(a.alias, "updated");
    }
    #[test]
    fn totp_round_trips_in_backups_without_overwriting_existing_configuration() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        s.configure_totp(&id, totp_input(Some("JBSWY3DPEHPK3PXP")))
            .unwrap();
        let backup = root.path().join("backup.json");
        s.export(&backup).unwrap();
        let mut target = Store::new(root.path().join("target-config/storage.json"));
        target.open(&root.path().join("target")).unwrap();
        assert_eq!(target.import(&backup).unwrap(), (1, 0));
        assert_eq!(
            target.account(&id).unwrap().totp.as_ref().unwrap().secret,
            "JBSWY3DPEHPK3PXP"
        );
        target
            .configure_totp(&id, totp_input(Some("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")))
            .unwrap();
        assert_eq!(target.import(&backup).unwrap(), (0, 1));
        assert_eq!(
            target.account(&id).unwrap().totp.as_ref().unwrap().secret,
            "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        );
        target.remove_totp(&id).unwrap();
        drop(target);
        let target = Store::new(root.path().join("target-config/storage.json"));
        assert!(target.account(&id).unwrap().totp.is_none());
    }
    #[test]
    fn persistence_password_preservation_and_explicit_clear() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        let created = s.account(&id).unwrap().created_at;
        let pw_time = s.account(&id).unwrap().password_updated_at;
        let summary =
            serde_json::to_string(&AccountSummary::from(s.account(&id).unwrap())).unwrap();
        assert!(!summary.contains("p@ss"));
        assert!(summary.contains("hasPassword"));
        let mut edit = input();
        edit.id = Some(id.clone());
        edit.password = None;
        edit.alias = "主账户".into();
        s.save(edit).unwrap();
        assert_eq!(s.account(&id).unwrap().password, "  p@ss 中文  ");
        assert_eq!(s.account(&id).unwrap().created_at, created);
        assert_eq!(s.account(&id).unwrap().password_updated_at, pw_time);
        drop(s);
        let mut s = Store::new(root.path().join("config/storage.json"));
        assert!(s.startup_error.is_none());
        assert_eq!(s.account(&id).unwrap().emails.len(), 1);
        let mut edit = input();
        edit.id = Some(id.clone());
        edit.password = Some(String::new());
        s.save(edit).unwrap();
        assert!(!AccountSummary::from(s.account(&id).unwrap()).has_password);
        let previous =
            decode(&read_limited(&root.path().join("data/accounts.previous.json")).unwrap())
                .unwrap();
        assert_eq!(previous.accounts[0].password, "  p@ss 中文  ");
        let mut edit = input();
        edit.id = Some(id.clone());
        edit.password = Some(" new password ".into());
        s.save(edit).unwrap();
        assert_eq!(s.account(&id).unwrap().password, " new password ");
    }
    #[test]
    fn multiple_contacts_and_shared_contacts_across_accounts() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let mut a = input();
        let mut phone = contact("+1 (555) 010-2020");
        phone.primary = false;
        let mut email = contact("work@example.com");
        email.primary = false;
        a.phones.push(phone);
        a.emails.push(email);
        let id = s.save(a).unwrap();
        assert_eq!(s.account(&id).unwrap().phones.len(), 2);
        let mut b = input();
        b.username = "bob".into();
        s.save(b).unwrap();
        assert_eq!(s.vault.accounts.len(), 2);
        let mut duplicate = input();
        duplicate.platform = "github".into();
        assert!(s.save(duplicate).is_err());
        let mut alias = input();
        alias.alias = "工作账户".into();
        assert!(s.save(alias).is_ok());
    }
    #[test]
    fn invalid_input_is_rejected_before_any_write() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let before = s.raw.clone();
        let mut a = input();
        a.website = "javascript:alert(1)".into();
        assert!(s.save(a).is_err());
        let mut a = input();
        a.website = "https://name:pass@example.com".into();
        assert!(s.save(a).is_err());
        let mut a = input();
        a.phones.push(contact("+8613800000000"));
        assert!(s.save(a).is_err());
        let mut a = input();
        a.emails.push(contact("alice@EXAMPLE.COM"));
        assert!(s.save(a).is_err());
        let mut a = input();
        a.phones.push(contact("15500000000"));
        assert!(s.save(a).is_err());
        let mut a = input();
        a.emails[0].value = "invalid email".into();
        assert!(s.save(a).is_err());
        let mut a = input();
        a.tags = vec!["Dev".into(), "dev".into()];
        assert!(s.save(a).is_err());
        let mut a = input();
        a.color = "#中文!!".into();
        assert!(s.save(a).is_err());
        assert_eq!(s.raw, before);
        assert!(s.vault.accounts.is_empty());
    }
    #[test]
    fn directory_lock_external_edit_and_corruption_protection() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        let mut second = Store::new(root.path().join("second/storage.json"));
        assert!(second.open(&root.path().join("data")).is_err());
        fs::write(root.path().join("data/accounts.json"), "external edit").unwrap();
        assert!(s.delete(&id).is_err());
        assert_eq!(s.vault.accounts.len(), 1);
        assert_eq!(
            fs::read_to_string(root.path().join("data/accounts.json")).unwrap(),
            "external edit"
        );
        assert!(s.open(&root.path().join("data")).is_err());
        drop(s);
        let failed = Store::new(root.path().join("config/storage.json"));
        assert!(failed.startup_error.is_some());
        assert!(failed.dir.is_none());
    }
    #[test]
    fn failed_commit_keeps_memory_and_live_file() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let before = s.raw.clone();
        fs::create_dir(root.path().join("data/accounts.previous.json")).unwrap();
        assert!(s.save(input()).is_err());
        assert!(s.vault.accounts.is_empty());
        assert_eq!(
            fs::read(root.path().join("data/accounts.json")).unwrap(),
            before
        );
    }
    #[test]
    fn backup_merge_is_repeatable_and_never_overwrites_existing_passwords() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        let backup = root.path().join("backup.json");
        s.export(&backup).unwrap();
        assert!(s.export(&backup).is_err());
        assert!(s.export(&root.path().join("storage.json")).is_err());
        let mut edit = input();
        edit.id = Some(id.clone());
        edit.password = Some("latest".into());
        s.save(edit).unwrap();
        assert_eq!(s.import(&backup).unwrap(), (0, 1));
        assert_eq!(s.account(&id).unwrap().password, "latest");
        let mut target = Store::new(root.path().join("second/storage.json"));
        target.open(&root.path().join("target")).unwrap();
        assert_eq!(target.import(&backup).unwrap(), (1, 0));
        assert_eq!(target.account(&id).unwrap().password, "  p@ss 中文  ");
        let mut edit = input();
        edit.id = Some(id);
        edit.username = "renamed".into();
        target.save(edit).unwrap();
        assert_eq!(target.import(&backup).unwrap(), (0, 1));
        assert_eq!(target.vault.accounts.len(), 1);
        let invalid = root.path().join("invalid.json");
        fs::write(&invalid, r#"{"format":"2FAuth","version":1,"accounts":[]}"#).unwrap();
        assert!(target.import(&invalid).is_err());
        fs::write(
            &invalid,
            r#"{"format":"DeskAuth","version":999,"accounts":[]}"#,
        )
        .unwrap();
        assert!(target.import(&invalid).is_err());
        assert_eq!(target.vault.accounts.len(), 1);
    }
    #[test]
    fn directory_switch_and_missing_directory_do_not_silently_reset() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        s.save(input()).unwrap();
        let dirty = root.path().join("dirty");
        fs::create_dir(&dirty).unwrap();
        fs::write(dirty.join("notes.txt"), "keep").unwrap();
        assert!(s.open(&dirty).is_err());
        assert_eq!(s.vault.accounts.len(), 1);
        s.open(&root.path().join("empty")).unwrap();
        assert!(s.vault.accounts.is_empty());
        s.open(&root.path().join("data")).unwrap();
        assert_eq!(s.vault.accounts.len(), 1);
        drop(s);
        fs::remove_file(root.path().join("data/accounts.json")).unwrap();
        let s = Store::new(root.path().join("config/storage.json"));
        assert!(s.startup_error.is_some());
        assert!(!root.path().join("data/accounts.json").exists());
    }
}
