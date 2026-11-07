//! Read-only bridge for an explicitly chosen 2FAuth backup. Recovery codes are ignored.
use crate::{otp, store};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, path::Path};

#[derive(Deserialize)]
struct Backup {
    format: String,
    version: u32,
    accounts: Vec<Entry>,
}
#[derive(Deserialize)]
struct Entry {
    id: String,
    issuer: String,
    account: String,
    secret: String,
    algorithm: otp::Algorithm,
    digits: u32,
    period: u64,
}
#[derive(Serialize)]
pub struct EntrySummary {
    id: String,
    issuer: String,
    account: String,
    algorithm: otp::Algorithm,
    digits: u32,
    period: u64,
}
#[derive(Serialize)]
pub struct Preview {
    fingerprint: String,
    entries: Vec<EntrySummary>,
}
fn read(path: &Path) -> Result<(Backup, String), String> {
    let raw = store::read_limited(path)?;
    let fingerprint = format!("{:x}", Sha256::digest(&raw));
    let bytes = raw.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&raw);
    let mut backup: Backup = serde_json::from_slice(bytes)
        .map_err(|_| "无法读取 2FAuth 备份，请选择其导出的 JSON 文件")?;
    if backup.format != "2FAuth" || backup.version != 1 || backup.accounts.len() > 2000 {
        return Err("需要有效的 2FAuth v1 备份文件".into());
    }
    let mut ids = HashSet::new();
    for a in &mut backup.accounts {
        if uuid::Uuid::parse_str(&a.id).is_err()
            || !ids.insert(a.id.clone())
            || a.issuer.len() > 240
            || a.account.trim().is_empty()
            || a.account.len() > 320
        {
            return Err("备份包含无效或重复的账户信息".into());
        }
        a.secret = otp::normalize_secret(&a.secret)?;
        otp::validate_params(a.digits, a.period)?;
    }
    Ok((backup, fingerprint))
}
pub fn preview(path: &Path) -> Result<Preview, String> {
    let (backup, fingerprint) = read(path)?;
    Ok(Preview {
        fingerprint,
        entries: backup
            .accounts
            .into_iter()
            .map(|a| EntrySummary {
                id: a.id,
                issuer: a.issuer,
                account: a.account,
                algorithm: a.algorithm,
                digits: a.digits,
                period: a.period,
            })
            .collect(),
    })
}
pub fn select(path: &Path, fingerprint: &str, id: &str) -> Result<otp::ParsedUri, String> {
    let (backup, current) = read(path)?;
    if current != fingerprint {
        return Err("备份文件已变化，请重新选择文件并核对条目".into());
    }
    let a = backup
        .accounts
        .into_iter()
        .find(|a| a.id == id)
        .ok_or("所选认证条目不存在")?;
    Ok(otp::ParsedUri {
        issuer: a.issuer,
        account: a.account,
        secret: a.secret,
        algorithm: a.algorithm,
        digits: a.digits,
        period: a.period,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preview_redacts_secrets_selection_is_read_only_and_changes_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backup.json");
        let raw = serde_json::to_vec(&serde_json::json!({"format":"2FAuth", "version":1, "accounts":[{
            "id":uuid::Uuid::new_v4().to_string(), "issuer":"GitHub", "account":"alice", "secret":"JBSWY3DPEHPK3PXP",
            "algorithm":"SHA256", "digits":8, "period":60, "recoveryCodes":[{"code":"never-import-me"}]
        }]})).unwrap();
        std::fs::write(&path, &raw).unwrap();
        let p = preview(&path).unwrap();
        let json = serde_json::to_string(&p).unwrap();
        assert!(!json.contains("JBSWY"));
        assert!(!json.contains("never-import-me"));
        let selected = select(&path, &p.fingerprint, &p.entries[0].id).unwrap();
        assert_eq!(selected.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(selected.period, 60);
        assert_eq!(std::fs::read(&path).unwrap(), raw);
        std::fs::write(&path, [&raw[..], b" "].concat()).unwrap();
        assert!(select(&path, &p.fingerprint, &p.entries[0].id).is_err());
        std::fs::write(&path, br#"{"format":"DeskAuth","version":1,"accounts":[]}"#).unwrap();
        assert!(preview(&path).is_err());
    }
}
