//! Optional application clock. Never changes the OS clock or accesses account data.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::watch;

const REFRESH: Duration = Duration::from_secs(15 * 60);
const RETRY: Duration = Duration::from_secs(60);
const MAX_AGE: Duration = Duration::from_secs(60 * 60);
const MAX_RTT_MS: u64 = 3000;
const MAX_DISAGREEMENT_MS: i64 = 2000;
const SOURCES: [(&str, &str); 3] = [
    ("Cloudflare", "https://www.cloudflare.com/cdn-cgi/trace"),
    ("Microsoft", "https://www.microsoft.com/"),
    ("Google", "https://www.google.com/generate_204"),
];

pub fn unix_ms() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "系统时间早于 1970 年，请校准系统时间".to_owned())?
        .as_millis()
        .try_into()
        .map_err(|_| "系统时间超出支持范围".into())
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Settings {
    #[serde(default)]
    online_time_enabled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeStatus {
    pub enabled: bool,
    pub syncing: bool,
    pub source: &'static str,
    pub offset_ms: i64,
    pub uncertainty_ms: Option<u64>,
    pub last_success_at: Option<i64>,
    pub valid_until: Option<i64>,
    pub providers: Vec<String>,
    pub error: Option<String>,
    pub revision: u64,
}

struct Calibration {
    offset_ms: i64,
    local_at: i64,
    instant: Instant,
    uncertainty_ms: u64,
    providers: Vec<String>,
}

struct Clock {
    enabled: bool,
    syncing: bool,
    generation: u64,
    revision: u64,
    calibration: Option<Calibration>,
    last_success_at: Option<i64>,
    last_attempt: Option<Instant>,
    last_failed: bool,
    error: Option<String>,
}

impl Clock {
    fn invalidate(&mut self, local: i64, now: Instant) {
        let reason = self.calibration.as_ref().and_then(|c| {
            let elapsed = now.saturating_duration_since(c.instant);
            if elapsed >= MAX_AGE {
                Some("校时结果已过期，已回退本地时间")
            } else if ((local - c.local_at) - elapsed.as_millis() as i64).abs() > 2000 {
                Some("检测到系统时间变化或休眠，已回退本地时间并等待重新校时")
            } else {
                None
            }
        });
        if let Some(reason) = reason {
            self.calibration = None;
            self.error = Some(reason.into());
            self.revision += 1;
            // Retry promptly once, without retrying on every status read.
            self.last_attempt = None;
        }
    }

    fn status(&mut self, local: i64, now: Instant) -> TimeStatus {
        self.invalidate(local, now);
        let c = self.calibration.as_ref().filter(|_| self.enabled);
        TimeStatus {
            enabled: self.enabled,
            syncing: self.syncing,
            source: if c.is_some() { "network" } else { "local" },
            offset_ms: c.map(|c| c.offset_ms).unwrap_or(0),
            uncertainty_ms: c.map(|c| c.uncertainty_ms),
            last_success_at: self.last_success_at,
            valid_until: c.map(|c| c.local_at + c.offset_ms + MAX_AGE.as_millis() as i64),
            providers: c.map(|c| c.providers.clone()).unwrap_or_default(),
            error: self.error.clone(),
            revision: self.revision,
        }
    }

    fn begin(&mut self, now: Instant) -> Option<u64> {
        let interval = if self.last_failed { RETRY } else { REFRESH };
        if !self.enabled
            || self.syncing
            || self
                .last_attempt
                .is_some_and(|t| now.saturating_duration_since(t) < interval)
        {
            return None;
        }
        self.syncing = true;
        self.last_attempt = Some(now);
        self.revision += 1;
        Some(self.generation)
    }

    fn finish(&mut self, generation: u64, result: Result<Calibration, String>) {
        if !self.enabled || self.generation != generation {
            return;
        }
        self.syncing = false;
        self.revision += 1;
        match result {
            Ok(c) => {
                self.last_success_at = Some(c.local_at + c.offset_ms);
                self.calibration = Some(c);
                self.error = None;
                self.last_failed = false;
            }
            Err(e) => {
                self.error = Some(e);
                self.last_failed = true;
            }
        }
    }
}

pub struct TimeService {
    clock: Mutex<Clock>,
    settings_path: PathBuf,
    changed: watch::Sender<u64>,
}

impl TimeService {
    pub fn new(settings_path: PathBuf) -> Self {
        let loaded = if settings_path.exists() {
            crate::store::read_limited(&settings_path).and_then(|bytes| {
                serde_json::from_slice::<Settings>(&bytes)
                    .map_err(|_| "校时设置文件无效，已默认关闭联网校时".into())
            })
        } else {
            Ok(Settings::default())
        };
        let (enabled, error) = match loaded {
            Ok(s) => (s.online_time_enabled, None),
            Err(e) => (false, Some(e)),
        };
        let (changed, _) = watch::channel(0);
        Self {
            clock: Mutex::new(Clock {
                enabled,
                syncing: false,
                generation: 0,
                revision: 0,
                calibration: None,
                last_success_at: None,
                last_attempt: None,
                last_failed: false,
                error,
            }),
            settings_path,
            changed,
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Clock>, String> {
        self.clock
            .lock()
            .map_err(|_| "校时状态异常，请重启应用".into())
    }
    pub fn status(&self) -> Result<TimeStatus, String> {
        Ok(self.lock()?.status(unix_ms()?, Instant::now()))
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<TimeStatus, String> {
        let mut clock = self.lock()?;
        let parent = self.settings_path.parent().ok_or("校时设置路径无效")?;
        fs::create_dir_all(parent).map_err(|_| "无法创建校时设置目录")?;
        let bytes = serde_json::to_vec_pretty(&Settings {
            online_time_enabled: enabled,
        })
        .map_err(|_| "无法保存校时设置")?;
        crate::store::atomic_write(&self.settings_path, &bytes, true)?;
        clock.enabled = enabled;
        clock.generation += 1;
        clock.revision += 1;
        clock.calibration = None;
        clock.last_success_at = None;
        clock.last_attempt = None;
        clock.last_failed = false;
        clock.syncing = false;
        clock.error = None;
        self.changed.send_replace(clock.generation);
        Ok(clock.status(unix_ms()?, Instant::now()))
    }

    pub fn request_sync(&self) -> Result<TimeStatus, String> {
        let mut clock = self.lock()?;
        if !clock.enabled {
            return Err("请先开启联网校时".into());
        }
        if !clock.syncing {
            clock.last_attempt = None;
            clock.generation += 1;
            self.changed.send_replace(clock.generation);
        }
        Ok(clock.status(unix_ms()?, Instant::now()))
    }

    pub fn now(&self) -> Result<(u64, TimeStatus), String> {
        let mut clock = self.lock()?;
        let local = unix_ms()?;
        let instant = Instant::now();
        let status = clock.status(local, instant);
        let corrected = match clock.calibration.as_ref().filter(|_| clock.enabled) {
            Some(c) => {
                c.local_at
                    + c.offset_ms
                    + instant.saturating_duration_since(c.instant).as_millis() as i64
            }
            None => local,
        };
        Ok((
            corrected.try_into().map_err(|_| "校正后的时间无效")?,
            status,
        ))
    }

    pub async fn run(self: Arc<Self>) {
        self.run_with(fetch_time).await;
    }

    async fn run_with<F, Fut>(self: Arc<Self>, fetch: F)
    where
        F: Fn() -> Fut,
        Fut: std::future::Future<Output = Result<Calibration, String>>,
    {
        let mut changes = self.changed.subscribe();
        loop {
            let generation = match self.lock() {
                Ok(mut clock) => {
                    changes.borrow_and_update();
                    if let Ok(local) = unix_ms() {
                        clock.invalidate(local, Instant::now());
                    }
                    clock.begin(Instant::now())
                }
                Err(_) => return,
            };
            if let Some(generation) = generation {
                // Dropping the request future cancels in-flight HTTP requests on disable.
                let result = tokio::select! {
                    biased;
                    _ = changes.changed() => continue,
                    result = fetch() => result,
                };
                if let Ok(mut clock) = self.lock() {
                    clock.finish(generation, result);
                }
            } else {
                tokio::select! {
                    _ = changes.changed() => {},
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {},
                }
            }
        }
    }
}

struct Sample {
    provider: String,
    offset_ms: i64,
    rtt_ms: u64,
}

fn parse_date(
    date: &str,
    age: Option<&str>,
    rtt: u64,
    local_start: i64,
    local_end: i64,
) -> Result<i64, String> {
    if rtt > MAX_RTT_MS {
        return Err("响应延迟过高".into());
    }
    if ((local_end - local_start) - rtt as i64).abs() > 1000 {
        return Err("请求期间系统时间发生变化".into());
    }
    if let Some(age) = age {
        if age.parse::<u64>().map_err(|_| "无效缓存时间")? != 0 {
            return Err("时间响应来自过期缓存".into());
        }
    }
    let server = httpdate::parse_http_date(date)
        .map_err(|_| "无效的服务器时间")?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "服务器时间无效")?
        .as_millis() as i64;
    // HTTP Date is quantized to seconds. Use its midpoint and half the round trip.
    Ok(server + 500 + rtt as i64 / 2 - local_end)
}

async fn sample(client: &reqwest::Client, provider: &str, url: &str) -> Result<Sample, String> {
    let started = Instant::now();
    let local_start = unix_ms()?;
    let response = client
        .get(url)
        .query(&[("_2fauth_time", uuid::Uuid::new_v4().to_string())])
        .header(reqwest::header::CACHE_CONTROL, "no-cache, no-store")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!("{provider}：请求超时")
            } else {
                format!("{provider}：连接或证书校验失败")
            }
        })?;
    let rtt_ms = started.elapsed().as_millis() as u64;
    let local_end = unix_ms()?;
    if !response.status().is_success() && !response.status().is_redirection() {
        return Err(format!("{provider}：HTTP {}", response.status().as_u16()));
    }
    let headers = response.headers();
    let date = headers
        .get(reqwest::header::DATE)
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| format!("{provider}：缺少时间响应"))?;
    let age = headers
        .get(reqwest::header::AGE)
        .map(|h| h.to_str().map_err(|_| "无效缓存时间"))
        .transpose()?;
    let offset_ms = parse_date(date, age, rtt_ms, local_start, local_end)
        .map_err(|e| format!("{provider}：{e}"))?;
    Ok(Sample {
        provider: provider.into(),
        offset_ms,
        rtt_ms,
    })
}

fn consensus(samples: &[Sample]) -> Result<(i64, u64, Vec<String>), String> {
    let mut pairs = Vec::new();
    for (i, a) in samples.iter().enumerate() {
        for b in samples.iter().skip(i + 1) {
            if (a.offset_ms - b.offset_ms).abs() <= MAX_DISAGREEMENT_MS {
                pairs.push((a, b));
            }
        }
    }
    let (a, b) = pairs
        .into_iter()
        .min_by_key(|(a, b)| a.rtt_ms + b.rtt_ms)
        .ok_or("需要至少两个时间来源一致；本次未采用网络时间")?;
    let uncertainty =
        500 + a.rtt_ms.max(b.rtt_ms) / 2 + (a.offset_ms - b.offset_ms).unsigned_abs() / 2;
    Ok((
        (a.offset_ms + b.offset_ms) / 2,
        uncertainty,
        vec![a.provider.clone(), b.provider.clone()],
    ))
}

async fn fetch_time() -> Result<Calibration, String> {
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .user_agent("2FAuth-Time/0.1")
        .build()
        .map_err(|_| "无法初始化 HTTPS 校时")?;
    let start = Instant::now();
    let local_start = unix_ms()?;
    let results = tokio::join!(
        sample(&client, SOURCES[0].0, SOURCES[0].1),
        sample(&client, SOURCES[1].0, SOURCES[1].1),
        sample(&client, SOURCES[2].0, SOURCES[2].1)
    );
    let local_at = unix_ms()?;
    let instant = Instant::now();
    if ((local_at - local_start) - start.elapsed().as_millis() as i64).abs() > 1000 {
        return Err("校时期间系统时间变化，请重试".into());
    }
    let mut samples = Vec::new();
    let mut errors = Vec::new();
    for result in [results.0, results.1, results.2] {
        match result {
            Ok(s) => samples.push(s),
            Err(e) => errors.push(e),
        }
    }
    let (offset_ms, uncertainty_ms, providers) = consensus(&samples).map_err(|e| {
        if errors.is_empty() {
            e
        } else {
            format!("{e}。{}", errors.join("；"))
        }
    })?;
    Ok(Calibration {
        offset_ms,
        local_at,
        instant,
        uncertainty_ms,
        providers,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn service() -> (tempfile::TempDir, TimeService) {
        let dir = tempfile::tempdir().unwrap();
        let s = TimeService::new(dir.path().join("time-settings.json"));
        (dir, s)
    }
    fn calibration(offset_ms: i64, now: Instant) -> Calibration {
        Calibration {
            offset_ms,
            local_at: 1_800_000_000_000,
            instant: now,
            uncertainty_ms: 600,
            providers: vec!["test-a".into(), "test-b".into()],
        }
    }
    #[test]
    fn defaults_and_settings_persistence() {
        let (dir, service) = service();
        assert!(!service.status().unwrap().enabled);
        assert!(service.lock().unwrap().begin(Instant::now()).is_none());
        assert!(service.request_sync().is_err());
        service.set_enabled(true).unwrap();
        let restored = TimeService::new(dir.path().join("time-settings.json"));
        assert!(restored.status().unwrap().enabled);
        assert_eq!(restored.status().unwrap().source, "local");
        service.set_enabled(false).unwrap();
        assert!(
            !TimeService::new(dir.path().join("time-settings.json"))
                .status()
                .unwrap()
                .enabled
        );
        fs::write(dir.path().join("time-settings.json"), "broken").unwrap();
        let broken = TimeService::new(dir.path().join("time-settings.json"));
        assert!(!broken.status().unwrap().enabled);
        assert!(broken.status().unwrap().error.is_some());
    }
    #[test]
    fn failed_save_does_not_enable_network() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("file"), "unchanged").unwrap();
        let s = TimeService::new(dir.path().join("file/settings.json"));
        assert!(s.set_enabled(true).is_err());
        assert!(!s.status().unwrap().enabled);
    }
    #[test]
    fn disable_discards_late_responses_and_zeroes_offset() {
        let (_dir, s) = service();
        s.set_enabled(true).unwrap();
        let generation = s.lock().unwrap().begin(Instant::now()).unwrap();
        s.set_enabled(false).unwrap();
        s.lock()
            .unwrap()
            .finish(generation, Ok(calibration(90_000, Instant::now())));
        let status = s.status().unwrap();
        assert_eq!(status.offset_ms, 0);
        assert_eq!(status.source, "local");
        assert!(!status.syncing);
        s.set_enabled(true).unwrap();
        s.lock()
            .unwrap()
            .finish(generation, Ok(calibration(90_000, Instant::now())));
        assert!(s.lock().unwrap().calibration.is_none());
    }
    #[test]
    fn failure_keeps_valid_result_expiry_and_clock_jump_invalidate_it() {
        let (_dir, s) = service();
        s.set_enabled(true).unwrap();
        let now = Instant::now();
        let mut c = s.lock().unwrap();
        let generation = c.begin(now).unwrap();
        c.finish(generation, Ok(calibration(-90_000, now)));
        c.finish(generation, Err("offline".into()));
        let status = c.status(1_800_000_000_000 + 60_000, now + Duration::from_secs(60));
        assert_eq!(status.source, "network");
        assert_eq!(status.offset_ms, -90_000);
        assert!(status.error.is_some());
        let status = c.status(
            1_800_000_000_000 + MAX_AGE.as_millis() as i64,
            now + MAX_AGE,
        );
        assert_eq!(status.source, "local");
        assert_eq!(status.offset_ms, 0);
        c.finish(generation, Ok(calibration(90_000, now)));
        let status = c.status(1_800_000_000_000 + 90_000, now + Duration::from_secs(1));
        assert_eq!(status.source, "local");
        assert!(status.error.unwrap().contains("系统时间变化"));
    }
    #[test]
    fn consensus_rejects_lone_and_disagreeing_sources() {
        let s = |name: &str, offset_ms| Sample {
            provider: name.into(),
            offset_ms,
            rtt_ms: 200,
        };
        assert!(consensus(&[s("a", 0)]).is_err());
        assert!(consensus(&[s("a", 0), s("b", 90_000)]).is_err());
        let (offset, _, sources) =
            consensus(&[s("a", -60_000), s("b", -59_800), s("c", 80_000)]).unwrap();
        assert_eq!(offset, -59_900);
        assert_eq!(sources, ["a", "b"]);
    }
    #[test]
    fn date_delay_cache_and_clock_changes() {
        let date = "Wed, 21 Oct 2015 07:28:00 GMT";
        let server = 1_445_412_480_000;
        assert_eq!(
            parse_date(date, None, 200, server + 30_000, server + 30_200).unwrap(),
            -29_600
        );
        assert!(parse_date(date, Some("10"), 200, server, server + 200).is_err());
        assert!(parse_date(date, None, 4000, server, server + 4000).is_err());
        assert!(parse_date(date, None, 200, server, server + 10_000).is_err());
        assert!(parse_date("garbage", None, 0, server, server).is_err());
    }
    #[test]
    fn retries_are_bounded() {
        let (_dir, s) = service();
        s.set_enabled(true).unwrap();
        let now = Instant::now();
        let mut c = s.lock().unwrap();
        let generation = c.begin(now).unwrap();
        assert!(c.begin(now).is_none());
        c.finish(generation, Err("offline".into()));
        assert!(c.begin(now + Duration::from_secs(59)).is_none());
        assert!(c.begin(now + RETRY).is_some());
    }
    #[tokio::test]
    async fn worker_stays_off_and_cancels_inflight_request() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::sync::Notify;
        struct PendingRequest(Arc<Notify>);
        impl Drop for PendingRequest {
            fn drop(&mut self) {
                self.0.notify_one();
            }
        }
        let (_dir, service) = service();
        let service = Arc::new(service);
        let calls = Arc::new(AtomicUsize::new(0));
        let started = Arc::new(Notify::new());
        let cancelled = Arc::new(Notify::new());
        let worker = tokio::spawn(service.clone().run_with({
            let calls = calls.clone();
            let started = started.clone();
            let cancelled = cancelled.clone();
            move || {
                calls.fetch_add(1, Ordering::SeqCst);
                let started = started.clone();
                let cancelled = cancelled.clone();
                async move {
                    let _request = PendingRequest(cancelled);
                    started.notify_one();
                    std::future::pending::<Result<Calibration, String>>().await
                }
            }
        }));
        tokio::task::yield_now().await;
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        service.set_enabled(true).unwrap();
        tokio::time::timeout(Duration::from_secs(1), started.notified())
            .await
            .unwrap();
        assert!(service.status().unwrap().syncing);
        service.set_enabled(false).unwrap();
        tokio::time::timeout(Duration::from_secs(1), cancelled.notified())
            .await
            .unwrap();
        assert_eq!(service.status().unwrap().source, "local");
        assert!(!service.status().unwrap().syncing);
        // A second enable must start a new request, not leave a stale busy flag.
        service.set_enabled(true).unwrap();
        tokio::time::timeout(Duration::from_secs(1), started.notified())
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        service.set_enabled(false).unwrap();
        worker.abort();
        let _ = worker.await;
    }

    #[test]
    fn corrected_epoch_is_used_and_disable_restores_wall_clock() {
        let (_dir, service) = service();
        service.set_enabled(true).unwrap();
        for offset_ms in [-90_000, 90_000] {
            let local_at = unix_ms().unwrap();
            let c = Calibration {
                local_at,
                instant: Instant::now(),
                ..calibration(offset_ms, Instant::now())
            };
            {
                let mut clock = service.lock().unwrap();
                let generation = clock.generation;
                clock.finish(generation, Ok(c));
            }
            let (corrected, status) = service.now().unwrap();
            assert!((corrected as i64 - unix_ms().unwrap() - offset_ms).abs() < 100);
            assert_eq!(status.source, "network");
        }
        service.set_enabled(false).unwrap();
        let (local, status) = service.now().unwrap();
        assert!((local as i64 - unix_ms().unwrap()).abs() < 100);
        assert_eq!(status.offset_ms, 0);
    }

    #[tokio::test]
    #[ignore = "explicit live HTTPS check; sends no account data"]
    async fn live_https_sources() {
        let calibration = fetch_time()
            .await
            .expect("HTTPS sources should reach consensus");
        println!(
            "sources={:?}; offset_ms={}; uncertainty_ms={}",
            calibration.providers, calibration.offset_ms, calibration.uncertainty_ms
        );
    }
}
