use data_encoding::{BASE32, BASE32_NOPAD};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Algorithm {
    SHA1,
    SHA256,
    SHA512,
}

pub fn normalize_secret(value: &str) -> Result<String, String> {
    let compact: String = value
        .chars()
        .filter(|c| !c.is_ascii_whitespace() && *c != '-')
        .collect::<String>()
        .to_ascii_uppercase();
    if compact.len() > 2048 {
        return Err("密钥过长".into());
    }
    let decoded = if compact.contains('=') {
        BASE32.decode(compact.as_bytes())
    } else {
        BASE32_NOPAD.decode(compact.as_bytes())
    }
    .map_err(|_| "密钥必须是有效的 Base32（A–Z、2–7），请检查是否完整复制")?;
    if decoded.len() < 10 {
        return Err("密钥至少需要 80 位（16 个 Base32 字符）".into());
    }
    Ok(BASE32_NOPAD.encode(&decoded))
}

pub fn validate_params(digits: u32, period: u64) -> Result<(), String> {
    if !(6..=8).contains(&digits) {
        return Err("验证码位数必须为 6、7 或 8".into());
    }
    if !(1..=300).contains(&period) {
        return Err("时间周期必须为 1–300 秒".into());
    }
    Ok(())
}

pub fn generate(
    secret: &str,
    algorithm: Algorithm,
    digits: u32,
    period: u64,
    timestamp: u64,
) -> Result<String, String> {
    validate_params(digits, period)?;
    let key = BASE32_NOPAD
        .decode(normalize_secret(secret)?.as_bytes())
        .map_err(|_| "密钥无效")?;
    let counter = (timestamp / period).to_be_bytes();
    macro_rules! sign { ($hash:ty) => {{
        let mut mac = Hmac::<$hash>::new_from_slice(&key).map_err(|_| "无法初始化认证算法")?;
        mac.update(&counter);
        mac.finalize().into_bytes().to_vec()
    }}; }
    let hash = match algorithm {
        Algorithm::SHA1 => sign!(Sha1),
        Algorithm::SHA256 => sign!(Sha256),
        Algorithm::SHA512 => sign!(Sha512),
    };
    let offset = (hash[hash.len() - 1] & 15) as usize;
    let binary = u32::from_be_bytes(
        hash[offset..offset + 4]
            .try_into()
            .map_err(|_| "认证计算失败")?,
    ) & 0x7fff_ffff;
    Ok(format!(
        "{:0width$}",
        binary % 10u32.pow(digits),
        width = digits as usize
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedUri {
    pub issuer: String,
    pub account: String,
    pub secret: String,
    pub algorithm: Algorithm,
    pub digits: u32,
    pub period: u64,
}

pub fn parse_uri(value: &str) -> Result<ParsedUri, String> {
    if value.len() > 8192 {
        return Err("认证链接过长".into());
    }
    let uri = url::Url::parse(value.trim()).map_err(|_| "请输入有效的 otpauth://totp/ 认证链接")?;
    if uri.scheme() != "otpauth"
        || uri.host_str() != Some("totp")
        || !uri.username().is_empty()
        || uri.password().is_some()
        || uri.port().is_some()
        || uri.fragment().is_some()
    {
        return Err("仅支持 otpauth://totp/ 链接；不支持 HOTP、Steam 或批量迁移二维码".into());
    }
    let mut params = HashMap::new();
    for (key, value) in uri.query_pairs() {
        if !["secret", "issuer", "algorithm", "digits", "period"].contains(&key.as_ref()) {
            return Err("链接包含不支持的参数，请使用手动添加并核对平台要求".into());
        }
        if params
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err("认证链接包含重复参数".into());
        }
    }
    let label = percent_encoding::percent_decode_str(uri.path().trim_start_matches('/'))
        .decode_utf8()
        .map_err(|_| "账户名称编码无效")?;
    let (prefix, account) = label.split_once(':').unwrap_or(("", &label));
    let issuer = params
        .get("issuer")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(prefix.trim());
    if !prefix.trim().is_empty() && issuer != prefix.trim() {
        return Err("链接中的平台名称不一致，请核对原始链接".into());
    }
    if account.trim().is_empty() {
        return Err("认证链接缺少账户名称".into());
    }
    let algorithm = match params
        .get("algorithm")
        .map(|s| s.to_ascii_uppercase())
        .as_deref()
        .unwrap_or("SHA1")
    {
        "SHA1" => Algorithm::SHA1,
        "SHA256" => Algorithm::SHA256,
        "SHA512" => Algorithm::SHA512,
        _ => return Err("仅支持 SHA1、SHA256、SHA512".into()),
    };
    let digits = params
        .get("digits")
        .map(|s| s.parse::<u32>())
        .transpose()
        .map_err(|_| "验证码位数无效")?
        .unwrap_or(6);
    let period = params
        .get("period")
        .map(|s| s.parse::<u64>())
        .transpose()
        .map_err(|_| "时间周期无效")?
        .unwrap_or(30);
    validate_params(digits, period)?;
    let secret = normalize_secret(params.get("secret").ok_or("认证链接缺少 secret 密钥")?)?;
    Ok(ParsedUri {
        issuer: issuer.to_owned(),
        account: account.trim().to_owned(),
        secret,
        algorithm,
        digits,
        period,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rfc6238_all_eighteen_vectors() {
        let keys = [
            b"12345678901234567890".as_slice(),
            b"12345678901234567890123456789012",
            b"1234567890123456789012345678901234567890123456789012345678901234",
        ];
        let cases = [
            (59, ["94287082", "46119246", "90693936"]),
            (1111111109, ["07081804", "68084774", "25091201"]),
            (1111111111, ["14050471", "67062674", "99943326"]),
            (1234567890, ["89005924", "91819424", "93441116"]),
            (2000000000, ["69279037", "90698825", "38618901"]),
            (20000000000, ["65353130", "77737706", "47863826"]),
        ];
        for (time, expected) in cases {
            for (i, algo) in [Algorithm::SHA1, Algorithm::SHA256, Algorithm::SHA512]
                .into_iter()
                .enumerate()
            {
                assert_eq!(
                    generate(&BASE32_NOPAD.encode(keys[i]), algo, 8, 30, time).unwrap(),
                    expected[i]
                );
            }
        }
    }
    #[test]
    fn boundaries_and_leading_zeroes() {
        let key = BASE32_NOPAD.encode(b"12345678901234567890");
        assert_eq!(
            generate(&key, Algorithm::SHA1, 6, 30, 29).unwrap(),
            "755224"
        );
        assert_eq!(
            generate(&key, Algorithm::SHA1, 6, 30, 30).unwrap(),
            "287082"
        );
        assert_eq!(
            generate(&key, Algorithm::SHA1, 6, 60, 59).unwrap(),
            "755224"
        );
        assert_eq!(
            generate(&key, Algorithm::SHA1, 6, 30, 1111111109).unwrap(),
            "081804"
        );
    }
    #[test]
    fn uri_and_base32_validation() {
        let p = parse_uri(
            "otpauth://totp/GitHub%3Aalice%2Bdev?secret=jbsw-y3dp ehpk3pxp&issuer=GitHub",
        )
        .unwrap();
        assert_eq!(p.account, "alice+dev");
        assert_eq!(p.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(p.period, 30);
        for suffix in [
            "&digits=0",
            "&period=0",
            "&algorithm=MD5",
            "&secret=JBSWY3DPEHPK3PXP",
            "&issuer=Other",
            "&counter=0",
        ] {
            assert!(parse_uri(&format!(
                "otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP{suffix}"
            ))
            .is_err());
        }
        assert!(parse_uri("otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP").is_err());
        assert!(normalize_secret("JBSWY3DPEHPK3PX0").is_err());
        assert!(normalize_secret("ABC").is_err());
        assert!(normalize_secret("JBSWY3DPEHPK3PXP=").is_err());
        assert_eq!(
            normalize_secret(&BASE32.encode(b"12345678901")).unwrap(),
            BASE32_NOPAD.encode(b"12345678901")
        );
    }
}
