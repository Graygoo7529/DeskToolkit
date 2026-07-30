//! 运行目录与文件存储层。
//!
//! 目录结构：
//! ```text
//! <运行目录>/
//!   projects/
//!     <项目id>/
//!       project.json      项目元数据 + 快速启动 + 一键启动
//!       docs/
//!         看板.md          默认看板文档
//!         *.md             用户文档
//! ```
//! 运行目录的路径指针保存在应用配置目录的 `deskfinger-config.json` 中。

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Manager};

use crate::Project;

// ---------- 运行目录指针 ----------

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    Ok(dir.join("deskfinger-config.json"))
}

/// 读取已配置的运行目录；目录不存在或结构不完整时返回 None。
pub fn get_runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    let path = config_path(app).ok()?;
    let text = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let dir = PathBuf::from(value.get("runtimeDir")?.as_str()?);
    if dir.join("projects").is_dir() {
        Some(dir)
    } else {
        None
    }
}

/// 设置（或更换）运行目录，并初始化目录结构。
pub fn set_runtime_dir(app: &AppHandle, dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir.join("projects")).map_err(|e| format!("初始化运行目录失败: {e}"))?;
    let body = serde_json::json!({ "runtimeDir": dir.to_string_lossy() });
    fs::write(
        config_path(app)?,
        serde_json::to_string_pretty(&body).unwrap(),
    )
    .map_err(|e| format!("写入配置失败: {e}"))
}

fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    get_runtime_dir(app)
        .map(|d| d.join("projects"))
        .ok_or_else(|| "尚未设置运行目录".to_string())
}

fn validate_project_id(id: &str) -> Result<&str, String> {
    let id = id.trim();
    if id.is_empty() || id.len() > 128 {
        return Err("项目 ID 非法".to_string());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("项目 ID 包含非法字符".to_string());
    }
    Ok(id)
}

fn canonical_projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = projects_dir(app)?;
    fs::canonicalize(&dir).map_err(|e| format!("无法解析项目根目录: {e}"))
}

fn safe_existing_child_dir(parent: &Path, name: &str, label: &str) -> Result<PathBuf, String> {
    let name = validate_project_id(name)?;
    let parent = fs::canonicalize(parent).map_err(|e| format!("无法解析{label}根目录: {e}"))?;
    let candidate = parent.join(name);
    let metadata = fs::symlink_metadata(&candidate).map_err(|_| format!("{label}不存在"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("{label}路径不安全"));
    }
    let canonical =
        fs::canonicalize(&candidate).map_err(|e| format!("无法解析{label}路径: {e}"))?;
    if canonical.parent() != Some(parent.as_path()) {
        return Err(format!("{label}路径越过允许目录"));
    }
    Ok(canonical)
}

fn project_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let root = canonical_projects_dir(app)?;
    safe_existing_child_dir(&root, id, "项目")
}

// ---------- JSON 读写 ----------

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("读取文件失败: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("解析文件失败: {e}"))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| format!("写入文件失败: {e}"))
}

// ---------- 项目 ----------

pub fn list_projects(app: &AppHandle) -> Result<Vec<Project>, String> {
    let dir = canonical_projects_dir(app)?;
    let mut projects = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取项目列表失败: {e}"))?;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        let Ok(project_dir) = safe_existing_child_dir(&dir, &id, "项目") else {
            continue;
        };
        let meta = project_dir.join("project.json");
        if let Ok(p) = read_json::<Project>(&meta) {
            if p.id == id {
                projects.push(p);
            }
        }
    }
    projects.sort_by_key(|p| p.created_at);
    Ok(projects)
}

pub fn create_project(app: &AppHandle, project: &Project, kanban: &str) -> Result<(), String> {
    let id = validate_project_id(&project.id)?;
    let dir = canonical_projects_dir(app)?.join(id);
    if dir.exists() {
        return Err("项目已存在".to_string());
    }
    let docs = dir.join("docs");
    fs::create_dir_all(&docs).map_err(|e| format!("创建项目目录失败: {e}"))?;
    fs::write(docs.join("看板.md"), kanban).map_err(|e| format!("创建看板文档失败: {e}"))?;
    write_json(&dir.join("project.json"), project)
}

pub fn save_project(app: &AppHandle, project: &Project) -> Result<(), String> {
    let dir = project_dir(app, &project.id)?;
    write_json(&dir.join("project.json"), project)
}

pub fn delete_project(app: &AppHandle, id: &str) -> Result<(), String> {
    let dir = project_dir(app, id)?;
    fs::remove_dir_all(&dir).map_err(|e| format!("删除项目失败: {e}"))
}

// ---------- 项目文档 ----------

fn docs_dir(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let project = project_dir(app, project_id)?;
    let dir = project.join("docs");
    if !dir.exists() {
        fs::create_dir(&dir).map_err(|e| format!("创建文档目录失败: {e}"))?;
    }
    safe_existing_child_dir(&project, "docs", "文档目录")
}

/// 校验文档名：不允许路径分隔符，强制 `.md` 后缀。
pub fn normalize_doc_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name == "." {
        return Err("文档名不能为空".to_string());
    }
    if name.contains("..") {
        return Err("文档名包含非法字符".to_string());
    }
    let normalized = if name.ends_with(".md") {
        name.to_string()
    } else {
        format!("{name}.md")
    };
    let mut components = Path::new(&normalized).components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return Err("文档名包含非法字符".to_string());
    }
    Ok(normalized)
}

fn doc_path(app: &AppHandle, project_id: &str, name: &str) -> Result<(PathBuf, String), String> {
    let name = normalize_doc_name(name)?;
    let dir = docs_dir(app, project_id)?;
    let path = dir.join(&name);
    if path.exists() {
        let metadata = fs::symlink_metadata(&path).map_err(|e| format!("读取文档信息失败: {e}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("文档路径不安全".to_string());
        }
        let canonical = fs::canonicalize(&path).map_err(|e| format!("无法解析文档路径: {e}"))?;
        if canonical.parent() != Some(dir.as_path()) {
            return Err("文档路径越过允许目录".to_string());
        }
    }
    Ok((path, name))
}

pub fn list_docs(app: &AppHandle, project_id: &str) -> Result<Vec<String>, String> {
    let dir = docs_dir(app, project_id)?;
    let mut names = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取文档列表失败: {e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".md") {
            names.push(name);
        }
    }
    names.sort_by(|a, b| {
        let pin = |n: &str| if n == "看板.md" { 0 } else { 1 };
        pin(a).cmp(&pin(b)).then_with(|| a.cmp(b))
    });
    Ok(names)
}

pub fn read_doc(app: &AppHandle, project_id: &str, name: &str) -> Result<String, String> {
    let (path, _) = doc_path(app, project_id, name)?;
    fs::read_to_string(&path).map_err(|e| format!("读取文档失败: {e}"))
}

pub fn write_doc(
    app: &AppHandle,
    project_id: &str,
    name: &str,
    content: &str,
) -> Result<(), String> {
    let (path, _) = doc_path(app, project_id, name)?;
    fs::write(&path, content).map_err(|e| format!("保存文档失败: {e}"))
}

pub fn create_doc(app: &AppHandle, project_id: &str, name: &str) -> Result<String, String> {
    let (path, name) = doc_path(app, project_id, name)?;
    if path.exists() {
        return Err("同名文档已存在".to_string());
    }
    let title = name.trim_end_matches(".md");
    fs::write(&path, format!("# {title}\n\n")).map_err(|e| format!("创建文档失败: {e}"))?;
    Ok(name)
}

pub fn delete_doc(app: &AppHandle, project_id: &str, name: &str) -> Result<(), String> {
    let (path, _) = doc_path(app, project_id, name)?;
    if !path.is_file() {
        return Err("文档不存在".to_string());
    }
    fs::remove_file(&path).map_err(|e| format!("删除文档失败: {e}"))
}

pub fn rename_doc(
    app: &AppHandle,
    project_id: &str,
    old: &str,
    new: &str,
) -> Result<String, String> {
    let (from, _) = doc_path(app, project_id, old)?;
    let (to, new) = doc_path(app, project_id, new)?;
    if !from.is_file() {
        return Err("原文档不存在".to_string());
    }
    if to.exists() {
        return Err("同名文档已存在".to_string());
    }
    fs::rename(&from, &to).map_err(|e| format!("重命名失败: {e}"))?;
    Ok(new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_id_rejects_path_traversal() {
        for invalid in ["", ".", "..", "../outside", "a/b", "a\\b", "C:\\temp"] {
            assert!(
                validate_project_id(invalid).is_err(),
                "accepted {invalid:?}"
            );
        }
        assert_eq!(validate_project_id("p0123-ab_CD").unwrap(), "p0123-ab_CD");
    }

    #[test]
    fn document_name_is_one_safe_component() {
        assert_eq!(normalize_doc_name("记录").unwrap(), "记录.md");
        assert_eq!(normalize_doc_name("notes.md").unwrap(), "notes.md");
        for invalid in ["", ".", "..", "../outside", "a/b", "a\\b", "C:\\temp"] {
            assert!(normalize_doc_name(invalid).is_err(), "accepted {invalid:?}");
        }
    }

    #[test]
    fn child_directory_must_remain_below_parent() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("p123")).unwrap();
        let child = safe_existing_child_dir(root.path(), "p123", "项目").unwrap();
        assert_eq!(
            child.parent(),
            Some(fs::canonicalize(root.path()).unwrap().as_path())
        );
        assert!(safe_existing_child_dir(root.path(), "../outside", "项目").is_err());
    }
}
