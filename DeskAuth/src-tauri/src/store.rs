use crate::model::{self, Account, AccountInput};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub const MANIFEST: &str = "deskauth.json";
const MAX_FILE: u64 = 512 * 1024;
const MAX_TOTAL: usize = 128 * 1024 * 1024;
const MARKER: &[u8] = br#"{
  "format": "DeskAuth",
  "storage": "account-files"
}
"#;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    format: String,
    storage: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountFile {
    format: String,
    account: Account,
}
struct Snapshot {
    accounts: Vec<Account>,
    raw: BTreeMap<String, Vec<u8>>,
    marker: Vec<u8>,
}

pub fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "无法读取文件，请检查路径和权限")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("账户及配置文件必须是普通文件".into());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| "无法打开文件")?
        .take(MAX_FILE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取文件失败")?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("单个文件不能超过 512 KB".into());
    }
    Ok(bytes)
}
fn decode(bytes: &[u8]) -> Result<Account, String> {
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    let mut file: AccountFile =
        serde_json::from_slice(bytes).map_err(|_| "账户 JSON 格式错误，原文件已保留")?;
    if file.format != "DeskAuthAccount" {
        return Err("需要 DeskAuthAccount 账户文件".into());
    }
    model::validate_account(&mut file.account)?;
    Ok(file.account)
}
fn encode(account: &Account) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec_pretty(&AccountFile {
        format: "DeskAuthAccount".into(),
        account: account.clone(),
    })
    .map_err(|_| "账户序列化失败")?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("单个账户不能超过 512 KB".into());
    }
    Ok(bytes)
}
fn directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "数据子目录不可用，请检查路径和权限")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("数据子目录必须是普通目录".into());
    }
    Ok(())
}
fn scan(dir: &Path) -> Result<Snapshot, String> {
    let marker = read_limited(&dir.join(MANIFEST))?;
    let manifest: Manifest =
        serde_json::from_slice(&marker).map_err(|_| "目录标记格式错误，需要有效 deskauth.json")?;
    if manifest.format != "DeskAuth" || manifest.storage != "account-files" {
        return Err("需要一账户一文件的 DeskAuth 数据目录".into());
    }
    let folder = dir.join("accounts");
    directory(&folder)?;
    let mut raw = BTreeMap::new();
    let mut accounts = Vec::new();
    let mut total = 0;
    for entry in fs::read_dir(&folder).map_err(|_| "无法读取账户目录")? {
        let path = entry.map_err(|_| "无法读取账户文件")?.path();
        if path.extension().and_then(|v| v.to_str()) != Some("json") {
            continue;
        }
        if accounts.len() >= 5000 {
            return Err("最多支持 5000 个账户".into());
        }
        let bytes = read_limited(&path)?;
        total += bytes.len();
        if total > MAX_TOTAL {
            return Err("账户目录超过 128 MB 限制".into());
        }
        let account = decode(&bytes).map_err(|e| {
            format!(
                "{}：{e}",
                path.file_name().unwrap_or_default().to_string_lossy()
            )
        })?;
        if path.file_name().and_then(|v| v.to_str()) != Some(&format!("{}.json", account.id)) {
            return Err("账户文件名必须与账户 ID 一致：<id>.json".into());
        }
        raw.insert(account.id.clone(), bytes);
        accounts.push(account);
    }
    model::validate_accounts(&mut accounts)?;
    accounts.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(Snapshot {
        accounts,
        raw,
        marker,
    })
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
fn initialize(dir: &Path) -> Result<(), String> {
    fs::create_dir(dir.join("accounts")).map_err(|_| "无法创建账户目录")?;
    fs::create_dir(dir.join("history")).map_err(|_| "无法创建历史目录")?;
    atomic_write(&dir.join(MANIFEST), MARKER, false)
}

pub struct Store {
    pub config_path: PathBuf,
    pub dir: Option<PathBuf>,
    pub accounts: Vec<Account>,
    raw: BTreeMap<String, Vec<u8>>,
    marker: Vec<u8>,
    directory_lock: Option<File>,
    pub startup_error: Option<String>,
}
impl Store {
    pub fn new(config_path: PathBuf) -> Self {
        let mut store = Self {
            config_path,
            dir: None,
            accounts: vec![],
            raw: BTreeMap::new(),
            marker: vec![],
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
                if !Path::new(dir).join(MANIFEST).is_file() {
                    return Err(
                        "原数据目录不可用；请连接一账户一文件的数据目录或选择新的空目录".into(),
                    );
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
        let exists = dir.join(MANIFEST).exists();
        if !exists {
            for entry in fs::read_dir(&dir).map_err(|_| "无法读取数据目录")? {
                if entry.map_err(|_| "无法读取数据目录")?.file_name() != ".deskauth.lock" {
                    return Err(
                        "请选择空目录或包含 deskauth.json 和 accounts/ 的 DeskAuth 目录".into(),
                    );
                }
            }
        }
        let lock = if same {
            None
        } else {
            let lock_path = dir.join(".deskauth.lock");
            if lock_path.exists()
                && fs::symlink_metadata(&lock_path)
                    .map_err(|_| "无法读取目录锁")?
                    .file_type()
                    .is_symlink()
            {
                return Err("目录锁不能是符号链接".into());
            }
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(&lock_path)
                .map_err(|_| "无法锁定数据目录")?;
            file.try_lock_exclusive()
                .map_err(|_| "该数据目录已被另一个 DeskAuth 窗口使用，请先关闭它")?;
            Some(file)
        };
        if !exists {
            initialize(&dir)?;
        }
        let snapshot = scan(&dir)?;
        let parent = self.config_path.parent().ok_or("配置目录无效")?;
        fs::create_dir_all(parent).map_err(|_| "无法创建配置目录")?;
        let pointer =
            serde_json::to_vec_pretty(&serde_json::json!({"dataDir": display_path(&dir)}))
                .map_err(|_| "保存目录失败")?;
        atomic_write(&self.config_path, &pointer, true)?;
        if !same {
            self.directory_lock = lock;
        }
        self.dir = Some(dir);
        self.accounts = snapshot.accounts;
        self.raw = snapshot.raw;
        self.marker = snapshot.marker;
        self.startup_error = None;
        Ok(())
    }
    pub fn account(&self, id: &str) -> Result<&Account, String> {
        self.accounts
            .iter()
            .find(|a| a.id == id)
            .ok_or_else(|| "账户不存在，请刷新列表".into())
    }
    fn unchanged(&self) -> Result<&Path, String> {
        let dir = self.dir.as_deref().ok_or("请先选择数据目录")?;
        let disk = scan(dir).map_err(|e| format!("数据目录已变化或不可用，请重新连接目录：{e}"))?;
        if disk.raw != self.raw || disk.marker != self.marker {
            return Err("数据文件已被外部修改，请在数据管理中重新连接目录后重试".into());
        }
        Ok(dir)
    }
    fn commit(&mut self, mut next: Vec<Account>, id: &str) -> Result<(), String> {
        model::validate_accounts(&mut next)?;
        let replacement = next.iter().find(|a| a.id == id).map(encode).transpose()?;
        let total: usize = self
            .raw
            .iter()
            .filter(|(key, _)| *key != id)
            .map(|(_, v)| v.len())
            .sum();
        if total + replacement.as_ref().map_or(0, Vec::len) > MAX_TOTAL {
            return Err("账户目录超过 128 MB 限制".into());
        }
        let dir = self.unchanged()?;
        let path = dir.join("accounts").join(format!("{id}.json"));
        if let Some(previous) = self.raw.get(id) {
            let history = dir.join("history");
            if !history.exists() {
                fs::create_dir(&history).map_err(|_| "无法创建历史目录")?;
            }
            directory(&history)?;
            let history_file = history.join(format!("{id}.json"));
            if history_file.exists() {
                read_limited(&history_file)?;
            }
            atomic_write(&history_file, previous, true)?;
        }
        if let Some(bytes) = &replacement {
            atomic_write(&path, bytes, self.raw.contains_key(id))?;
        } else {
            fs::remove_file(&path).map_err(|_| "无法删除账户文件，原记录已保留")?;
        }
        self.accounts = next;
        if let Some(bytes) = replacement {
            self.raw.insert(id.to_owned(), bytes);
        } else {
            self.raw.remove(id);
        }
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
            .accounts
            .iter()
            .any(|a| a.id != id && model::same_identity(a, &account))
        {
            return Err(
                "已存在相同平台、网站、用户名和别名的账户；可编辑原记录或使用不同别名".into(),
            );
        }
        let mut next = self.accounts.clone();
        if let Some(existing) = next.iter_mut().find(|a| a.id == id) {
            *existing = account;
        } else {
            next.push(account);
        }
        self.commit(next, &id)?;
        Ok(id)
    }
    pub fn favorite(&mut self, id: &str, value: bool) -> Result<(), String> {
        let mut next = self.accounts.clone();
        let a = next.iter_mut().find(|a| a.id == id).ok_or("账户不存在")?;
        a.favorite = value;
        a.updated_at = model::now_ms()?;
        self.commit(next, id)
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
        let mut next = self.accounts.clone();
        let a = next.iter_mut().find(|a| a.id == id).ok_or("账户不存在")?;
        a.totp = Some(crate::model::Totp {
            secret,
            algorithm: input.algorithm,
            digits: input.digits,
            period: input.period,
        });
        a.updated_at = model::now_ms()?;
        self.commit(next, id)
    }
    pub fn remove_totp(&mut self, id: &str) -> Result<(), String> {
        self.account(id)?;
        let mut next = self.accounts.clone();
        let a = next.iter_mut().find(|a| a.id == id).ok_or("账户不存在")?;
        a.totp = None;
        a.updated_at = model::now_ms()?;
        self.commit(next, id)
    }
    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        self.account(id)?;
        let mut next = self.accounts.clone();
        next.retain(|a| a.id != id);
        self.commit(next, id)
    }
    pub fn import(&mut self, path: &Path) -> Result<(usize, usize), String> {
        let imported = scan(path)?;
        let dir = self.unchanged()?.to_path_buf();
        let mut next = self.accounts.clone();
        let mut skipped = 0;
        let mut additions = Vec::new();
        for a in imported.accounts {
            if next
                .iter()
                .any(|b| b.id == a.id || model::same_identity(b, &a))
            {
                skipped += 1;
                continue;
            }
            additions.push(a.clone());
            next.push(a);
        }
        model::validate_accounts(&mut next)?;
        let mut staged = Vec::new();
        let mut total: usize = self.raw.values().map(Vec::len).sum();
        // Stage and sync every new account before publishing any file.
        for a in additions {
            let raw = encode(&a)?;
            total += raw.len();
            if total > MAX_TOTAL {
                return Err("账户目录超过 128 MB 限制".into());
            }
            let mut temp = tempfile::NamedTempFile::new_in(dir.join("accounts"))
                .map_err(|_| "无法创建导入临时文件")?;
            temp.write_all(&raw)
                .and_then(|_| temp.as_file().sync_all())
                .map_err(|_| "导入写入失败，原账户已保留")?;
            staged.push((a.id, raw, temp));
        }
        self.unchanged()?;
        let mut installed: Vec<(String, Vec<u8>)> = Vec::new();
        for (id, raw, temp) in staged {
            let path = dir.join("accounts").join(format!("{id}.json"));
            if temp.persist_noclobber(&path).is_err() {
                let mut rollback_failed = false;
                for (key, _) in &installed {
                    if fs::remove_file(dir.join("accounts").join(format!("{key}.json"))).is_err() {
                        rollback_failed = true;
                    }
                }
                if rollback_failed {
                    if let Ok(disk) = scan(&dir) {
                        self.accounts = disk.accounts;
                        self.raw = disk.raw;
                    }
                    return Err(
                        "导入中断，部分新文件未能撤回；请重新连接目录核对，已有账户未覆盖".into(),
                    );
                }
                return Err("导入未完成，新导入文件已撤回，已有账户未覆盖".into());
            }
            installed.push((id, raw));
        }
        let added = installed.len();
        self.accounts = next;
        self.raw.extend(installed);
        Ok((added, skipped))
    }
    pub fn export(&self, path: &Path) -> Result<(), String> {
        let dir = self.unchanged()?;
        if !path.is_absolute() || path.exists() {
            return Err("备份必须使用新的绝对目录路径，不覆盖已有目录".into());
        }
        let parent = path.parent().ok_or("备份目录无效")?;
        let parent = fs::canonicalize(parent).map_err(|_| "请选择可用的备份父目录")?;
        if parent.starts_with(dir) {
            return Err("请选择当前数据目录以外的位置保存备份".into());
        }
        let temp = tempfile::Builder::new()
            .prefix(".deskauth-backup-")
            .tempdir_in(parent)
            .map_err(|_| "无法创建备份目录")?;
        initialize(temp.path())?;
        for a in &self.accounts {
            atomic_write(
                &temp.path().join("accounts").join(format!("{}.json", a.id)),
                &encode(a)?,
                false,
            )?;
        }
        fs::rename(temp.path(), path).map_err(|_| "无法完成备份，目标可能已存在")?;
        Ok(())
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
    use crate::model::{AccountSummary, Contact, Purpose, TotpInput};
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
    fn file(root: &Path, id: &str) -> PathBuf {
        root.join("data/accounts").join(format!("{id}.json"))
    }
    fn history(root: &Path, id: &str) -> PathBuf {
        root.join("data/history").join(format!("{id}.json"))
    }
    fn totp(secret: Option<&str>) -> TotpInput {
        TotpInput {
            secret: secret.map(str::to_owned),
            algorithm: crate::otp::Algorithm::SHA1,
            digits: 6,
            period: 30,
        }
    }
    #[test]
    fn one_file_contains_the_whole_account_and_other_files_are_untouched() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        s.configure_totp(&id, totp(Some("JBSWY3DPEHPK3PXP")))
            .unwrap();
        let mut second = input();
        second.username = "bob".into();
        let second_id = s.save(second).unwrap();
        let second_file = file(root.path(), &second_id);
        let second_raw = fs::read(&second_file).unwrap();
        let modified = fs::metadata(&second_file).unwrap().modified().unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(file(root.path(), &id)).unwrap()).unwrap();
        assert_eq!(json["format"], "DeskAuthAccount");
        assert_eq!(json["account"]["password"], "  p@ss 中文  ");
        assert_eq!(json["account"]["totp"]["secret"], "JBSWY3DPEHPK3PXP");
        assert_eq!(json["account"]["phones"][0]["value"], "+86 138-0000-0000");
        assert!(!root.path().join("data/accounts.json").exists());
        s.favorite(&id, true).unwrap();
        assert_eq!(fs::read(&second_file).unwrap(), second_raw);
        assert_eq!(
            fs::metadata(&second_file).unwrap().modified().unwrap(),
            modified
        );
        drop(s);
        let s = Store::new(root.path().join("config/storage.json"));
        assert!(s.startup_error.is_none());
        assert_eq!(s.accounts.len(), 2);
        assert!(s.account(&id).unwrap().favorite);
    }
    #[test]
    fn password_edits_preserve_totp_and_history_then_delete_archives_the_account() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        let created = s.account(&id).unwrap().created_at;
        let pw_time = s.account(&id).unwrap().password_updated_at;
        s.configure_totp(&id, totp(Some("JBSWY3DPEHPK3PXP")))
            .unwrap();
        let mut edit = input();
        edit.id = Some(id.clone());
        edit.password = None;
        edit.alias = "主账户".into();
        s.save(edit).unwrap();
        assert_eq!(s.account(&id).unwrap().password, "  p@ss 中文  ");
        assert_eq!(s.account(&id).unwrap().created_at, created);
        assert_eq!(s.account(&id).unwrap().password_updated_at, pw_time);
        let mut edit = input();
        edit.id = Some(id.clone());
        edit.password = Some(String::new());
        s.save(edit).unwrap();
        assert!(!AccountSummary::from(s.account(&id).unwrap()).has_password);
        assert_eq!(
            decode(&fs::read(history(root.path(), &id)).unwrap())
                .unwrap()
                .password,
            "  p@ss 中文  "
        );
        assert!(s.account(&id).unwrap().totp.is_some());
        let raw = fs::read(file(root.path(), &id)).unwrap();
        s.delete(&id).unwrap();
        assert!(!file(root.path(), &id).exists());
        assert_eq!(fs::read(history(root.path(), &id)).unwrap(), raw);
        assert!(s.accounts.is_empty());
        // Restoring one archived JSON needs no index or whole-vault rewrite.
        fs::copy(history(root.path(), &id), file(root.path(), &id)).unwrap();
        s.open(&root.path().join("data")).unwrap();
        assert!(s.account(&id).unwrap().totp.is_some());
    }
    #[test]
    fn totp_parameters_and_removal_preserve_account_fields_and_redact_summaries() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        s.configure_totp(&id, totp(Some("JBSWY3DPEHPK3PXP")))
            .unwrap();
        let before = s.raw.clone();
        assert!(s.configure_totp(&id, totp(Some("invalid!"))).is_err());
        assert_eq!(s.raw, before);
        let mut params = totp(None);
        params.digits = 8;
        params.period = 60;
        s.configure_totp(&id, params).unwrap();
        assert_eq!(
            s.account(&id).unwrap().totp.as_ref().unwrap().secret,
            "JBSWY3DPEHPK3PXP"
        );
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
    }
    #[test]
    fn lock_external_changes_corruption_and_filename_mismatch_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        let mut other = Store::new(root.path().join("other/storage.json"));
        assert!(other.open(&root.path().join("data")).is_err());
        let mut account = s.account(&id).unwrap().clone();
        account.notes = "外部编辑".into();
        fs::write(file(root.path(), &id), encode(&account).unwrap()).unwrap();
        assert!(s.delete(&id).is_err());
        assert_eq!(s.accounts.len(), 1);
        s.open(&root.path().join("data")).unwrap();
        assert_eq!(s.account(&id).unwrap().notes, "外部编辑");
        let wrong = file(root.path(), &Uuid::new_v4().to_string());
        fs::rename(file(root.path(), &id), &wrong).unwrap();
        assert!(s.open(&root.path().join("data")).is_err());
        fs::rename(wrong, file(root.path(), &id)).unwrap();
        fs::write(file(root.path(), &id), "broken").unwrap();
        drop(s);
        let failed = Store::new(root.path().join("config/storage.json"));
        assert!(failed.startup_error.is_some());
        assert!(failed.dir.is_none());
        assert_eq!(
            fs::read_to_string(file(root.path(), &id)).unwrap(),
            "broken"
        );
    }
    #[test]
    fn external_addition_or_removal_requires_reconnect_without_overwriting_files() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        let mut a = s.account(&id).unwrap().clone();
        a.id = Uuid::new_v4().to_string();
        a.username = "bob".into();
        fs::write(file(root.path(), &a.id), encode(&a).unwrap()).unwrap();
        assert!(s.favorite(&id, true).is_err());
        s.open(&root.path().join("data")).unwrap();
        assert_eq!(s.accounts.len(), 2);
        fs::remove_file(file(root.path(), &a.id)).unwrap();
        assert!(s.delete(&id).is_err());
        assert!(file(root.path(), &id).is_file());
    }
    #[test]
    fn failed_history_write_keeps_live_account_and_memory() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        let before = s.raw.clone();
        fs::create_dir(history(root.path(), &id)).unwrap();
        assert!(s.favorite(&id, true).is_err());
        assert!(s.delete(&id).is_err());
        assert_eq!(s.raw, before);
        assert_eq!(fs::read(file(root.path(), &id)).unwrap(), before[&id]);
        assert!(!s.account(&id).unwrap().favorite);
    }
    #[test]
    fn directory_backups_round_trip_and_duplicate_imports_preserve_existing_secrets() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        let id = s.save(input()).unwrap();
        s.configure_totp(&id, totp(Some("JBSWY3DPEHPK3PXP")))
            .unwrap();
        let mut second = input();
        second.username = "bob".into();
        s.save(second).unwrap();
        let backup = root.path().join("backup");
        s.export(&backup).unwrap();
        assert!(backup.join("deskauth.json").is_file());
        assert_eq!(scan(&backup).unwrap().accounts.len(), 2);
        assert!(s.export(&backup).is_err());
        assert!(s.export(&root.path().join("data/nested")).is_err());
        let mut target = Store::new(root.path().join("target-config/storage.json"));
        target.open(&root.path().join("target")).unwrap();
        assert_eq!(target.import(&backup).unwrap(), (2, 0));
        assert_eq!(target.account(&id).unwrap().password, "  p@ss 中文  ");
        assert!(target.account(&id).unwrap().totp.is_some());
        target
            .configure_totp(&id, totp(Some("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")))
            .unwrap();
        assert_eq!(target.import(&backup).unwrap(), (0, 2));
        assert_eq!(
            target.account(&id).unwrap().totp.as_ref().unwrap().secret,
            "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        );
        let before = s.raw.clone();
        fs::write(
            backup.join("accounts").join(format!("{id}.json")),
            "invalid",
        )
        .unwrap();
        assert!(s.import(&backup).is_err());
        assert_eq!(s.raw, before);
    }
    #[test]
    fn validation_runs_before_writes_and_shared_contacts_remain_allowed() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
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
        a.emails[0].value = "invalid email".into();
        assert!(s.save(a).is_err());
        let mut a = input();
        a.tags = vec!["Dev".into(), "dev".into()];
        assert!(s.save(a).is_err());
        assert!(s.accounts.is_empty());
        assert!(s.raw.is_empty());
        let id = s.save(input()).unwrap();
        let mut duplicate = input();
        duplicate.platform = "github".into();
        assert!(s.save(duplicate).is_err());
        let mut second = input();
        second.alias = "工作".into();
        let mut phone = contact("15500000000");
        phone.primary = false;
        second.phones.push(phone);
        let second_id = s.save(second).unwrap();
        assert_eq!(s.account(&second_id).unwrap().phones.len(), 2);
        assert_eq!(s.account(&id).unwrap().emails[0].value, "Alice@example.com");
    }
    #[test]
    fn switching_directories_missing_roots_and_non_account_formats_do_not_reset_data() {
        let root = tempfile::tempdir().unwrap();
        let mut s = setup(root.path());
        s.save(input()).unwrap();
        let dirty = root.path().join("dirty");
        fs::create_dir(&dirty).unwrap();
        fs::write(dirty.join("accounts.json"), "preserve me").unwrap();
        assert!(s.open(&dirty).is_err());
        assert_eq!(
            fs::read_to_string(dirty.join("accounts.json")).unwrap(),
            "preserve me"
        );
        assert_eq!(s.accounts.len(), 1);
        s.open(&root.path().join("empty")).unwrap();
        assert!(s.accounts.is_empty());
        s.open(&root.path().join("data")).unwrap();
        assert_eq!(s.accounts.len(), 1);
        drop(s);
        fs::remove_file(root.path().join("data/deskauth.json")).unwrap();
        let s = Store::new(root.path().join("config/storage.json"));
        assert!(s.startup_error.is_some());
        assert!(!root.path().join("data/deskauth.json").exists());
    }
}
