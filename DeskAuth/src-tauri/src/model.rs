use crate::otp::{self, Algorithm};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Totp {
    pub secret: String,
    pub algorithm: Algorithm,
    pub digits: u32,
    pub period: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TotpInput {
    pub secret: Option<String>,
    pub algorithm: Algorithm,
    pub digits: u32,
    pub period: u64,
}
#[derive(Serialize)]
pub struct TotpSummary {
    pub algorithm: Algorithm,
    pub digits: u32,
    pub period: u64,
}
impl From<&Totp> for TotpSummary {
    fn from(t: &Totp) -> Self {
        Self {
            algorithm: t.algorithm,
            digits: t.digits,
            period: t.period,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    Login,
    Verify,
    Recovery,
    Contact,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Contact {
    pub id: String,
    pub value: String,
    pub label: String,
    pub purposes: Vec<Purpose>,
    pub primary: bool,
    pub notes: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub platform: String,
    pub website: String,
    pub alias: String,
    pub username: String,
    pub password: String,
    pub totp: Option<Totp>,
    pub phones: Vec<Contact>,
    pub emails: Vec<Contact>,
    pub group: String,
    pub tags: Vec<String>,
    pub color: String,
    pub favorite: bool,
    pub notes: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub password_updated_at: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountInput {
    pub id: Option<String>,
    pub platform: String,
    pub website: String,
    pub alias: String,
    pub username: String,
    // null keeps an existing password; an empty string explicitly clears it.
    pub password: Option<String>,
    pub phones: Vec<Contact>,
    pub emails: Vec<Contact>,
    pub group: String,
    pub tags: Vec<String>,
    pub color: String,
    pub notes: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String,
    pub platform: String,
    pub website: String,
    pub alias: String,
    pub username: String,
    pub has_password: bool,
    pub totp: Option<TotpSummary>,
    pub phones: Vec<Contact>,
    pub emails: Vec<Contact>,
    pub group: String,
    pub tags: Vec<String>,
    pub color: String,
    pub favorite: bool,
    pub notes: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub password_updated_at: Option<u64>,
}
impl From<&Account> for AccountSummary {
    fn from(a: &Account) -> Self {
        Self {
            id: a.id.clone(),
            platform: a.platform.clone(),
            website: a.website.clone(),
            alias: a.alias.clone(),
            username: a.username.clone(),
            has_password: !a.password.is_empty(),
            totp: a.totp.as_ref().map(TotpSummary::from),
            phones: a.phones.clone(),
            emails: a.emails.clone(),
            group: a.group.clone(),
            tags: a.tags.clone(),
            color: a.color.clone(),
            favorite: a.favorite,
            notes: a.notes.clone(),
            created_at: a.created_at,
            updated_at: a.updated_at,
            password_updated_at: a.password_updated_at,
        }
    }
}

pub fn validate_accounts(accounts: &mut [Account]) -> Result<(), String> {
    if accounts.len() > 5000 {
        return Err("最多支持 5000 个账户".into());
    }
    let mut ids = HashSet::new();
    let mut identities = HashSet::new();
    for a in accounts {
        validate_account(a)?;
        if !ids.insert(a.id.clone()) {
            return Err("数据包含重复账户 ID".into());
        }
        if !identities.insert((
            a.platform.to_lowercase(),
            a.website.trim_end_matches('/').to_owned(),
            a.username.clone(),
            a.alias.clone(),
        )) {
            return Err(
                "已存在相同平台、网站、用户名和别名的账户；可编辑原记录或使用不同别名".into(),
            );
        }
    }
    Ok(())
}
pub fn now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "系统时间无效，请检查电脑日期".into())
        .map(|d| d.as_millis() as u64)
}
pub fn contact_key(value: &str, phone: bool) -> String {
    if phone {
        value.chars().filter(char::is_ascii_digit).collect()
    } else {
        value.trim().to_lowercase()
    }
}
pub fn validate_website(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }
    let url = url::Url::parse(value).map_err(|_| "网站地址需要以 https:// 或 http:// 开头")?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("网站地址仅支持不含内嵌凭据的 HTTP / HTTPS 地址".into());
    }
    Ok(())
}
fn validate_contacts(contacts: &mut [Contact], phone: bool) -> Result<(), String> {
    if contacts.len() > 50 {
        return Err("每个账户最多保存 50 个手机号和 50 个邮箱".into());
    }
    let mut ids = HashSet::new();
    let mut values = HashSet::new();
    let mut primary = 0;
    for c in contacts {
        c.value = c.value.trim().to_owned();
        c.label = c.label.trim().to_owned();
        let key = contact_key(&c.value, phone);
        if Uuid::parse_str(&c.id).is_err()
            || !ids.insert(c.id.clone())
            || !values.insert(key.clone())
        {
            return Err("联系方式包含重复值或无效 ID".into());
        }
        if c.value.is_empty()
            || c.value.len() > 320
            || c.value.contains(['\r', '\n'])
            || c.label.chars().count() > 40
            || c.notes.chars().count() > 1000
        {
            return Err("请填写有效的联系方式；标签最多 40 字，备注最多 1000 字".into());
        }
        if phone {
            if key.len() < 3
                || key.len() > 32
                || !c
                    .value
                    .chars()
                    .all(|ch| ch.is_ascii_digit() || "+-(). ".contains(ch))
            {
                return Err("手机号请使用数字、国际区号及常见分隔符".into());
            }
        } else {
            let parts: Vec<_> = c.value.split('@').collect();
            if parts.len() != 2
                || parts.iter().any(|p| p.is_empty())
                || c.value.chars().any(char::is_whitespace)
            {
                return Err("请填写有效的邮箱地址".into());
            }
        }
        if c.purposes.len() > 4
            || c.purposes.iter().copied().collect::<HashSet<_>>().len() != c.purposes.len()
        {
            return Err("联系方式用途包含重复项".into());
        }
        primary += usize::from(c.primary);
    }
    if primary > 1 {
        return Err("手机号和邮箱各自只能设置一个主要联系方式".into());
    }
    Ok(())
}
pub fn validate_account(a: &mut Account) -> Result<(), String> {
    if Uuid::parse_str(&a.id).is_err() {
        return Err("账户 ID 无效".into());
    }
    a.platform = a.platform.trim().to_owned();
    a.username = a.username.trim().to_owned();
    a.website = a.website.trim().to_owned();
    a.alias = a.alias.trim().to_owned();
    a.group = a.group.trim().to_owned();
    if a.platform.is_empty()
        || a.username.is_empty()
        || a.platform.chars().count() > 120
        || a.username.chars().count() > 320
        || a.platform.contains(['\r', '\n'])
        || a.username.contains(['\r', '\n'])
    {
        return Err("请填写平台和用户名（最多 120 / 320 字）".into());
    }
    if a.alias.chars().count() > 120
        || a.group.chars().count() > 60
        || a.notes.chars().count() > 10000
        || a.password.len() > 4096
        || a.website.len() > 2048
    {
        return Err("账户字段过长，请缩短别名、分组、密码、网站地址或备注".into());
    }
    validate_website(&a.website)?;
    if a.color.len() != 7
        || !a.color.starts_with('#')
        || !a.color[1..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("账户颜色无效".into());
    }
    if a.tags.len() > 20 {
        return Err("每个账户最多添加 20 个标签".into());
    }
    let mut tags = HashSet::new();
    for t in &mut a.tags {
        *t = t.trim().to_owned();
        if t.is_empty() || t.chars().count() > 30 || !tags.insert(t.to_lowercase()) {
            return Err("标签为空、重复或超过 30 字".into());
        }
    }
    validate_contacts(&mut a.phones, true)?;
    validate_contacts(&mut a.emails, false)?;
    if let Some(t) = &mut a.totp {
        t.secret = otp::normalize_secret(&t.secret)?;
        otp::validate_params(t.digits, t.period)?;
    }
    Ok(())
}
pub fn same_identity(a: &Account, b: &Account) -> bool {
    a.platform.to_lowercase() == b.platform.to_lowercase()
        && a.username == b.username
        && a.alias == b.alias
        && a.website.trim_end_matches('/') == b.website.trim_end_matches('/')
}
