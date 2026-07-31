//! ACP 桥：管理常驻 `kimi acp` 子进程，NDJSON（每行一条 JSON-RPC 2.0 消息）。
//! 契约见 docs/architecture.md §9。协议路径上全部容错解析，禁止 panic/unwrap。

use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::quota;
use crate::AppState;

/// 握手类调用（initialize/authenticate/session/*）的超时；session/prompt 不设超时。
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(120);
/// 权限请求 5 分钟无响应自动选拒绝项。
const PERMISSION_TIMEOUT: Duration = Duration::from_secs(300);
/// 崩溃重启退避：1s 翻倍，封顶 30s。
const MAX_BACKOFF: Duration = Duration::from_secs(30);
/// CREATE_NO_WINDOW，避免拉起 kimi 时闪控制台窗口。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone)]
pub struct AcpHandle {
    app: AppHandle,
    inner: Arc<Mutex<AcpInner>>,
}

struct AcpInner {
    started: bool,
    ready: bool,
    session_id: Option<String>,
    /// 当前子进程的 stdin 写入通道；子进程重启时整体替换。
    outgoing: Option<mpsc::UnboundedSender<String>>,
    next_id: u64,
    /// 我们发出、等待响应的请求：id → 通知 channel。
    pending: HashMap<u64, oneshot::Sender<Value>>,
    prompt_in_flight: bool,
    /// 未就绪 / prompt 在途时排队的用户消息。
    queue: VecDeque<String>,
    /// 面板尚未答复的权限请求：前端 requestId → 待回内容。
    permissions: HashMap<String, PendingPermission>,
}

impl AcpInner {
    fn new() -> Self {
        Self {
            started: false,
            ready: false,
            session_id: None,
            outgoing: None,
            next_id: 0,
            pending: HashMap::new(),
            prompt_in_flight: false,
            queue: VecDeque::new(),
            permissions: HashMap::new(),
        }
    }
}

struct PendingPermission {
    server_id: Value,
    options: Vec<PermissionOption>,
}

#[derive(Clone, Serialize)]
struct PermissionOption {
    #[serde(rename = "optionId")]
    option_id: String,
    name: String,
    kind: String,
}

struct RpcError {
    code: i64,
    message: String,
}

impl RpcError {
    fn conn(message: impl Into<String>) -> Self {
        Self {
            code: -1,
            message: message.into(),
        }
    }
    fn is_auth_required(&self) -> bool {
        self.code == -32000
    }
}

impl fmt::Display for RpcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.code == -1 {
            write!(f, "{}", self.message)
        } else {
            write!(f, "{} (code {})", self.message, self.code)
        }
    }
}

// ---------------------------------------------------------------------------
// 对外入口（命令层调用）
// ---------------------------------------------------------------------------

impl AcpHandle {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            inner: Arc::new(Mutex::new(AcpInner::new())),
        }
    }

    /// 懒启动：首次 chat_send / 打开 chat tab 时调用；幂等。
    pub async fn ensure_started(&self) {
        let mut st = self.inner.lock().await;
        if st.started {
            return;
        }
        st.started = true;
        drop(st);
        let h = self.clone();
        tauri::async_runtime::spawn(async move { h.supervise().await });
    }

    pub async fn is_ready(&self) -> bool {
        self.inner.lock().await.ready
    }

    /// 消息一律入队；就绪且无在途 prompt 时踢动驱动任务（契约 §7/§9 排队语义）。
    pub async fn chat_send(&self, text: String) {
        self.ensure_started().await;
        let mut st = self.inner.lock().await;
        st.queue.push_back(text);
        if st.ready && !st.prompt_in_flight {
            st.prompt_in_flight = true;
            drop(st);
            self.kick_driver();
        }
    }

    /// 打断：通知 `session/cancel`（无 id）。prompt 响应随后自然收尾。
    pub async fn cancel(&self) {
        let (sid, tx) = {
            let st = self.inner.lock().await;
            (st.session_id.clone(), st.outgoing.clone())
        };
        if let (Some(sid), Some(tx)) = (sid, tx) {
            let _ = tx.send(
                json!({"jsonrpc": "2.0", "method": "session/cancel", "params": {"sessionId": sid}})
                    .to_string(),
            );
        }
    }

    /// 前端对权限请求的答复 → 回复 agent。
    pub async fn resolve_permission(&self, request_id: &str, option_id: &str) {
        let entry = self.inner.lock().await.permissions.remove(request_id);
        if let Some(p) = entry {
            reply_result(
                &self.inner,
                p.server_id,
                json!({"outcome": {"outcome": "selected", "optionId": option_id}}),
            )
            .await;
        } else {
            eprintln!("[deskbot][acp] 权限响应到达但请求已不存在（可能已超时）");
        }
    }

    // -----------------------------------------------------------------------
    // 子进程监管
    // -----------------------------------------------------------------------

    async fn supervise(&self) {
        let mut backoff = Duration::from_secs(1);
        loop {
            emit_chat(&self.app, json!({"type": "session", "status": "connecting"}));
            match self.run_child().await {
                Ok(()) => {
                    // 曾建立过会话的正常退出：立即重连
                    backoff = Duration::from_secs(1);
                    eprintln!("[deskbot][acp] 子进程退出，准备重启");
                }
                Err(e) => {
                    eprintln!("[deskbot][acp] 启动/握手失败: {e}");
                    emit_chat(
                        &self.app,
                        json!({"type": "session", "status": "error", "message": e}),
                    );
                }
            }
            {
                let mut st = self.inner.lock().await;
                st.ready = false;
                st.prompt_in_flight = false;
                st.outgoing = None;
                // 丢弃 pending 的 sender，等待中的 call 会以「连接中断」返回
                st.pending.clear();
                st.permissions.clear();
            }
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(MAX_BACKOFF);
        }
    }

    /// 拉起一轮子进程：spawn → 握手 → 就绪 → 等到 stdout EOF。
    /// Ok 表示至少走到了 EOF（会话曾建立）；Err 表示 spawn/握手失败。
    async fn run_child(&self) -> Result<(), String> {
        let cfg = self.app.state::<AppState>().config.get();
        let ws = self.app.state::<AppState>().config.workspace_abs();
        tokio::fs::create_dir_all(&ws)
            .await
            .map_err(|e| format!("创建 workspace 目录失败: {e}"))?;
        let mut child = spawn_kimi(&cfg.kimi_path, &ws)
            .map_err(|e| format!("无法启动 `{} acp`: {e}", cfg.kimi_path))?;

        let result = self.child_session(&mut child).await;
        let _ = child.kill().await;
        result
    }

    async fn child_session(&self, child: &mut Child) -> Result<(), String> {
        let stdin = child.stdin.take().ok_or("无法获取子进程 stdin")?;
        let stdout = child.stdout.take().ok_or("无法获取子进程 stdout")?;

        // 写出通道：任何位置要发消息只需 send 一行
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        self.inner.lock().await.outgoing = Some(tx);
        tauri::async_runtime::spawn(async move {
            let mut stdin = stdin;
            while let Some(line) = rx.recv().await {
                if stdin.write_all(line.as_bytes()).await.is_err()
                    || stdin.write_all(b"\n").await.is_err()
                    || stdin.flush().await.is_err()
                {
                    break;
                }
            }
        });

        // 读入循环：逐行分发；EOF 时清空 pending 让在途调用立即失败
        let (eof_tx, eof_rx) = oneshot::channel::<()>();
        {
            let app = self.app.clone();
            let inner = self.inner.clone();
            tauri::async_runtime::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    dispatch_line(&app, &inner, &line).await;
                }
                inner.lock().await.pending.clear();
                let _ = eof_tx.send(());
            });
        }

        self.handshake().await?;

        let sid = self.inner.lock().await.session_id.clone();
        emit_chat(
            &self.app,
            json!({"type": "session", "status": "ready", "sessionId": sid}),
        );
        self.pump_queue().await;

        let _ = eof_rx.await;
        Ok(())
    }

    /// initialize →（authRequired 时 authenticate）→ session/load|resume|new。
    async fn handshake(&self) -> Result<(), String> {
        let init = call(
            &self.inner,
            "initialize",
            json!({
                "protocolVersion": 1,
                "clientInfo": {"name": "deskbot", "version": "0.1.0"},
                "clientCapabilities": {
                    "fs": {"readTextFile": true, "writeTextFile": true},
                    "terminal": false
                }
            }),
            Some(HANDSHAKE_TIMEOUT),
        )
        .await
        .map_err(|e| format!("initialize 失败: {e}"))?;

        let auth_methods: Vec<String> = init
            .get("authMethods")
            .and_then(|m| m.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let cfg_session = self.app.state::<AppState>().config.get().session_id;
        match self.establish_session(cfg_session.clone()).await {
            Ok(sid) => {
                self.inner.lock().await.session_id = Some(sid);
            }
            Err(e) if e.is_auth_required() => {
                let Some(method) = auth_methods.first() else {
                    return Err("agent 要求认证但未提供 authMethods".into());
                };
                call(
                    &self.inner,
                    "authenticate",
                    json!({"methodId": method}),
                    Some(HANDSHAKE_TIMEOUT),
                )
                .await
                .map_err(|e| format!("authenticate 失败: {e}"))?;
                let sid = self
                    .establish_session(cfg_session)
                    .await
                    .map_err(|e| format!("认证后建立会话仍失败: {e}"))?;
                self.inner.lock().await.session_id = Some(sid);
            }
            Err(e) => return Err(format!("建立会话失败: {e}")),
        }
        self.inner.lock().await.ready = true;
        Ok(())
    }

    /// 有 sessionId → session/load（失败退 session/resume，再退 session/new）；无 → session/new。
    async fn establish_session(&self, session_id: Option<String>) -> Result<String, RpcError> {
        let cwd = self.app.state::<AppState>().config.workspace_abs();
        let cwd = cwd.to_string_lossy().replace('\\', "/");

        if let Some(sid) = session_id {
            for method in ["session/load", "session/resume"] {
                let params = json!({"cwd": cwd, "mcpServers": [], "sessionId": sid});
                match call(&self.inner, method, params, Some(HANDSHAKE_TIMEOUT)).await {
                    Ok(v) => {
                        return Ok(v
                            .get("sessionId")
                            .and_then(|s| s.as_str())
                            .map(String::from)
                            .unwrap_or(sid));
                    }
                    Err(e) if e.is_auth_required() => return Err(e),
                    Err(_) => continue,
                }
            }
        }

        let v = call(
            &self.inner,
            "session/new",
            json!({"cwd": cwd, "mcpServers": []}),
            Some(HANDSHAKE_TIMEOUT),
        )
        .await?;
        let sid = v
            .get("sessionId")
            .and_then(|s| s.as_str())
            .map(String::from)
            .ok_or_else(|| RpcError::conn("session/new 响应缺少 sessionId"))?;
        // 首次 session/new 后写回 config（契约 §3/§9）
        let write_back = sid.clone();
        self.app
            .state::<AppState>()
            .config
            .update(|c| c.session_id = Some(write_back));
        Ok(sid)
    }

    // -----------------------------------------------------------------------
    // prompt 生命周期
    // -----------------------------------------------------------------------

    /// 启动 prompt 驱动任务；调用前须已把 prompt_in_flight 置 true。
    /// 刻意保持同步 fn：若改为 async 会与 prompt_driver 形成互相包含的递归
    /// future 类型，rustc 无法证明 Send（spawn 要求 Send）。
    fn kick_driver(&self) {
        let h = self.clone();
        tauri::async_runtime::spawn(async move { h.prompt_driver().await });
    }

    /// 串行消费消息队列：队列空或连接掉线时收尾回 idle。
    async fn prompt_driver(&self) {
        emit_pet(&self.app, "chat_active");
        loop {
            let text = {
                let mut st = self.inner.lock().await;
                if st.ready {
                    st.queue.pop_front()
                } else {
                    None
                }
            };
            let Some(text) = text else { break };
            self.run_one_prompt(text).await;
        }
        self.inner.lock().await.prompt_in_flight = false;
        emit_pet(&self.app, "chat_idle");
    }

    async fn run_one_prompt(&self, text: String) {
        let sid = self.inner.lock().await.session_id.clone().unwrap_or_default();
        let result = call(
            &self.inner,
            "session/prompt",
            json!({"sessionId": sid, "prompt": [{"type": "text", "text": text}]}),
            None,
        )
        .await;
        match result {
            Ok(v) => {
                let stop_reason = v
                    .get("stopReason")
                    .and_then(|s| s.as_str())
                    .unwrap_or("unknown");
                emit_chat(&self.app, json!({"type": "done", "stopReason": stop_reason}));
                // 对话 done 后触发一次额度刷新（契约 §10）
                let app = self.app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = quota::refresh(&app).await;
                });
            }
            Err(e) => {
                emit_chat(&self.app, json!({"type": "error", "message": e.to_string()}));
            }
        }
    }

    /// 就绪且无在途 prompt 时踢动驱动任务（握手 ready 后调用）。
    async fn pump_queue(&self) {
        let mut st = self.inner.lock().await;
        if st.ready && !st.prompt_in_flight && !st.queue.is_empty() {
            st.prompt_in_flight = true;
            drop(st);
            self.kick_driver();
        }
    }
}

// ---------------------------------------------------------------------------
// JSON-RPC 基础设施
// ---------------------------------------------------------------------------

/// 发一条请求并等响应。`timeout=None` 表示不限时（session/prompt 用）。
async fn call(
    inner: &Arc<Mutex<AcpInner>>,
    method: &str,
    params: Value,
    timeout: Option<Duration>,
) -> Result<Value, RpcError> {
    let (id, tx, rx) = {
        let mut st = inner.lock().await;
        let Some(tx) = st.outgoing.clone() else {
            return Err(RpcError::conn("acp 未运行"));
        };
        st.next_id += 1;
        let id = st.next_id;
        let (req_tx, rx) = oneshot::channel();
        st.pending.insert(id, req_tx);
        (id, tx, rx)
    };
    let line = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string();
    if tx.send(line).is_err() {
        inner.lock().await.pending.remove(&id);
        return Err(RpcError::conn("acp stdin 已关闭"));
    }

    let msg = match timeout {
        Some(d) => match tokio::time::timeout(d, rx).await {
            Ok(m) => m,
            Err(_) => {
                inner.lock().await.pending.remove(&id);
                return Err(RpcError::conn(format!("{method} 响应超时")));
            }
        },
        None => rx.await,
    };
    match msg {
        Err(_) => Err(RpcError::conn("acp 连接中断")),
        Ok(v) => {
            if let Some(err) = v.get("error") {
                Err(RpcError {
                    code: err.get("code").and_then(|c| c.as_i64()).unwrap_or(-1),
                    message: err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("未知错误")
                        .to_string(),
                })
            } else {
                Ok(v.get("result").cloned().unwrap_or(Value::Null))
            }
        }
    }
}

async fn reply_result(inner: &Arc<Mutex<AcpInner>>, id: Value, result: Value) {
    send_line(inner, json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string()).await;
}

async fn reply_error(inner: &Arc<Mutex<AcpInner>>, id: Value, code: i64, message: String) {
    send_line(
        inner,
        json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
            .to_string(),
    )
    .await;
}

async fn send_line(inner: &Arc<Mutex<AcpInner>>, line: String) {
    let tx = inner.lock().await.outgoing.clone();
    if let Some(tx) = tx {
        let _ = tx.send(line);
    }
}

// ---------------------------------------------------------------------------
// 入站消息分发
// ---------------------------------------------------------------------------

async fn dispatch_line(app: &AppHandle, inner: &Arc<Mutex<AcpInner>>, line: &str) {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        eprintln!("[deskbot][acp] 忽略无法解析的行（{} 字节）", line.len());
        return;
    };
    if let Some(method) = v.get("method").and_then(|m| m.as_str()) {
        let params = v.get("params").cloned().unwrap_or(Value::Null);
        match v.get("id") {
            Some(id) if !id.is_null() => {
                handle_server_request(app, inner, id.clone(), method, params).await
            }
            _ => handle_notification(app, method, &params),
        }
    } else if let Some(id) = v.get("id").and_then(|i| i.as_u64()) {
        // 我们请求的响应
        let tx = inner.lock().await.pending.remove(&id);
        if let Some(tx) = tx {
            let _ = tx.send(v);
        }
    }
}

/// agent → 我们的通知（目前只关心 session/update）。
fn handle_notification(app: &AppHandle, method: &str, params: &Value) {
    if method != "session/update" {
        return;
    }
    let update = params.get("update").cloned().unwrap_or(Value::Null);
    let kind = update
        .get("sessionUpdate")
        .and_then(|s| s.as_str())
        .unwrap_or_default();
    match kind {
        "agent_message_chunk" => {
            let text = update
                .pointer("/content/text")
                .and_then(|t| t.as_str())
                .unwrap_or_default();
            if !text.is_empty() {
                emit_chat(app, json!({"type": "chunk", "text": text}));
            }
        }
        "tool_call" => {
            let id = update
                .get("toolCallId")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if id.is_empty() {
                return;
            }
            emit_chat(
                app,
                json!({
                    "type": "tool_call",
                    "toolCallId": id,
                    "title": update.get("title").and_then(|v| v.as_str()).unwrap_or_default(),
                    "kind": update.get("kind").and_then(|v| v.as_str()).unwrap_or_default(),
                    "status": update.get("status").and_then(|v| v.as_str()).unwrap_or_default(),
                }),
            );
        }
        "tool_call_update" => {
            let id = update
                .get("toolCallId")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if id.is_empty() {
                return;
            }
            // content[] 里的文本片段拼接为 contentText
            let mut parts: Vec<&str> = Vec::new();
            if let Some(arr) = update.get("content").and_then(|c| c.as_array()) {
                for item in arr {
                    if let Some(t) = item.pointer("/content/text").and_then(|t| t.as_str()) {
                        parts.push(t);
                    } else if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                        parts.push(t);
                    }
                }
            }
            emit_chat(
                app,
                json!({
                    "type": "tool_call_update",
                    "toolCallId": id,
                    "status": update.get("status").and_then(|v| v.as_str()).unwrap_or_default(),
                    "contentText": parts.join("\n"),
                }),
            );
        }
        // plan / agent_thought_chunk / available_commands_update 等：忽略
        _ => {}
    }
}

/// agent → 我们的请求（带 id，必须回复）。
async fn handle_server_request(
    app: &AppHandle,
    inner: &Arc<Mutex<AcpInner>>,
    id: Value,
    method: &str,
    params: Value,
) {
    match method {
        "fs/read_text_file" => {
            let path = params.get("path").and_then(|p| p.as_str()).unwrap_or_default();
            if path.is_empty() {
                reply_error(inner, id, -32602, "缺少 path".into()).await;
                return;
            }
            match tokio::fs::read_to_string(path).await {
                Ok(content) => {
                    let content = slice_lines(
                        &content,
                        params.get("line").and_then(|l| l.as_u64()),
                        params.get("limit").and_then(|l| l.as_u64()),
                    );
                    reply_result(inner, id, json!({"content": content})).await;
                }
                Err(e) => reply_error(inner, id, -32603, format!("读取失败: {e}")).await,
            }
        }
        "fs/write_text_file" => {
            let path = params.get("path").and_then(|p| p.as_str()).unwrap_or_default();
            let content = params
                .get("content")
                .and_then(|c| c.as_str())
                .unwrap_or_default();
            if path.is_empty() {
                reply_error(inner, id, -32602, "缺少 path".into()).await;
                return;
            }
            if let Some(parent) = Path::new(path).parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            match tokio::fs::write(path, content).await {
                Ok(()) => reply_result(inner, id, Value::Null).await,
                Err(e) => reply_error(inner, id, -32603, format!("写入失败: {e}")).await,
            }
        }
        "session/request_permission" => {
            let title = params
                .pointer("/toolCall/title")
                .and_then(|t| t.as_str())
                .unwrap_or("权限请求")
                .to_string();
            let options: Vec<PermissionOption> = params
                .get("options")
                .and_then(|o| o.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|o| PermissionOption {
                            option_id: o
                                .get("optionId")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            name: o
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            kind: o
                                .get("kind")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            let request_id = match &id {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            inner.lock().await.permissions.insert(
                request_id.clone(),
                PendingPermission {
                    server_id: id.clone(),
                    options: options.clone(),
                },
            );
            emit_chat(
                app,
                json!({
                    "type": "permission",
                    "requestId": request_id,
                    "title": title,
                    "options": options,
                }),
            );
            // 5 分钟无响应：自动选拒绝项（kind 含 reject 的第一个，没有则第一个）
            let inner2 = inner.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(PERMISSION_TIMEOUT).await;
                let entry = inner2.lock().await.permissions.remove(&request_id);
                if let Some(p) = entry {
                    let pick = p
                        .options
                        .iter()
                        .find(|o| o.kind.to_ascii_lowercase().contains("reject"))
                        .or(p.options.first());
                    match pick {
                        Some(opt) => {
                            reply_result(
                                &inner2,
                                p.server_id,
                                json!({"outcome": {"outcome": "selected", "optionId": opt.option_id}}),
                            )
                            .await;
                        }
                        None => {
                            reply_result(&inner2, p.server_id, json!({"outcome": {"outcome": "cancelled"}})).await;
                        }
                    }
                }
            });
        }
        _ => reply_error(inner, id, -32601, format!("未支持的方法: {method}")).await,
    }
}

/// fs/read_text_file 的 line（1 起始）/ limit 截取。
fn slice_lines(content: &str, line: Option<u64>, limit: Option<u64>) -> String {
    if line.is_none() && limit.is_none() {
        return content.to_string();
    }
    let start = line.unwrap_or(1).saturating_sub(1) as usize;
    let iter = content.lines().skip(start);
    match limit {
        Some(n) => iter.take(n as usize).collect::<Vec<_>>().join("\n"),
        None => iter.collect::<Vec<_>>().join("\n"),
    }
}

// ---------------------------------------------------------------------------
// spawn 与事件辅助
// ---------------------------------------------------------------------------

/// Windows 上 CreateProcess 只自动补 .exe；npm 全局装的 kimi 通常是 kimi.cmd shim。
fn spawn_kimi(kimi_path: &str, cwd: &Path) -> std::io::Result<Child> {
    let mut candidates: Vec<String> = vec![kimi_path.to_string()];
    #[cfg(windows)]
    {
        candidates.push(format!("{kimi_path}.cmd"));
        candidates.push(format!("{kimi_path}.bat"));
    }
    let mut last_err = None;
    for candidate in candidates {
        let mut cmd = Command::new(&candidate);
        cmd.arg("acp")
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        match cmd.spawn() {
            Ok(child) => return Ok(child),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                last_err = Some(e);
                continue;
            }
            Err(e) => return Err(e),
        }
    }
    Err(last_err.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "未找到 kimi 可执行文件")
    }))
}

fn emit_chat(app: &AppHandle, payload: Value) {
    let _ = app.emit_to("panel", "chat://event", payload);
}

fn emit_pet(app: &AppHandle, signal: &str) {
    let _ = app.emit_to("stage", "pet://signal", json!({"signal": signal}));
}
