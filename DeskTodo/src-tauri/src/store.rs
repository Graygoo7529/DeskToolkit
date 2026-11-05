//! Markdown is the source of note content; the index contains only identity and ordering.
use super::{Cluster, Note, Workspace};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
};

const INDEX: &str = ".desktodo/index.json";
const JOURNAL: &str = ".desktodo/pending.json";
const CONFLICT: &str = "文件已在外部修改。为保留两边的内容，已停止保存；可保留当前副本并重新载入。";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    version: u32,
    #[serde(default)]
    revision: u64,
    clusters: Vec<FolderEntry>,
}
#[derive(Clone, Serialize, Deserialize)]
struct FolderEntry {
    id: String,
    name: String,
    directory: String,
    icon: String,
    color: String,
    notes: Vec<NoteEntry>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteEntry {
    id: String,
    title: String,
    file: String,
    color: String,
    updated_at: u64,
}
pub struct Snapshot {
    pub workspace: Workspace,
    index: Index,
    files: BTreeMap<String, Vec<u8>>,
}
#[derive(Serialize, Deserialize)]
struct Change {
    path: String,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
}
#[derive(Serialize, Deserialize)]
struct Journal {
    changes: Vec<Change>,
    directories: Vec<String>,
}

fn json<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(value).map_err(|e| e.to_string())
}

// Reject traversal and links, including Windows junctions, before touching any child path.
fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("数据索引包含不安全的路径".into());
    }
    let mut path = root.to_path_buf();
    for part in relative.components() {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) => {
                let mut linked = meta.file_type().is_symlink();
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    linked |= meta.file_attributes() & 0x400 != 0;
                }
                if linked {
                    return Err(format!(
                        "便签路径不能包含符号链接或目录联接：{}",
                        path.display()
                    ));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(path)
}
fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取 {} 失败：{e}", path.display())),
    }
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("文件路径无效")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path)
        .map_err(|e| format!("保存 {} 失败：{e}", path.display()))?;
    Ok(())
}
fn lock_dir(root: &Path) -> Result<File, String> {
    let path = resolve(root, ".desktodo/write.lock")?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|e| e.to_string())?;
    lock.try_lock()
        .map_err(|_| "此数据目录正被另一个 DeskTodo 写入，请稍后重试".to_string())?;
    Ok(lock)
}
fn component(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':'])
}
fn validate_index(index: &Index) -> Result<(), String> {
    if index.version != 3 {
        return Err("不支持的数据索引版本".into());
    }
    let mut dirs = HashSet::new();
    for folder in &index.clusters {
        if !component(&folder.directory)
            || folder.directory.starts_with('.')
            || !dirs.insert(folder.directory.to_lowercase())
        {
            return Err("便签夹目录无效或重名".into());
        }
        let mut files = HashSet::new();
        for note in &folder.notes {
            if !component(&note.file)
                || !note.file.to_lowercase().ends_with(".md")
                || !files.insert(note.file.to_lowercase())
            {
                return Err("Markdown 文件名无效或重名".into());
            }
        }
    }
    Ok(())
}
fn read_current(root: &Path) -> Result<Snapshot, String> {
    let bytes = fs::read(resolve(root, INDEX)?).map_err(|e| format!("读取数据索引失败：{e}"))?;
    let index: Index =
        serde_json::from_slice(&bytes).map_err(|e| format!("数据索引损坏：{e}。原文件已保留。"))?;
    validate_index(&index)?;
    let mut files = BTreeMap::from([(INDEX.into(), bytes)]);
    let mut clusters = Vec::new();
    for folder in &index.clusters {
        let folder_path = resolve(root, &folder.directory)?;
        if !folder_path.is_dir() {
            return Err(format!("便签夹目录不存在：{}", folder.directory));
        }
        let mut notes = Vec::new();
        for entry in &folder.notes {
            let relative = format!("{}/{}", folder.directory, entry.file);
            let bytes = fs::read(resolve(root, &relative)?)
                .map_err(|e| format!("读取 {relative} 失败：{e}"))?;
            let content = String::from_utf8(bytes.clone())
                .map_err(|_| format!("{relative} 不是 UTF-8 Markdown 文件"))?;
            files.insert(relative, bytes);
            notes.push(Note {
                id: entry.id.clone(),
                title: entry.title.clone(),
                content,
                color: entry.color.clone(),
                updated_at: entry.updated_at,
            });
        }
        clusters.push(Cluster {
            id: folder.id.clone(),
            name: folder.name.clone(),
            icon: folder.icon.clone(),
            color: folder.color.clone(),
            notes,
        });
    }
    let workspace = Workspace { clusters };
    workspace.validate()?;
    Ok(Snapshot {
        workspace,
        index,
        files,
    })
}

// Sanitize Windows filenames without losing Chinese titles; comparisons are case insensitive.
fn stem(title: &str, fallback: &str) -> String {
    let name: String = title
        .chars()
        .take(64)
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let mut name = name.trim().trim_matches('.').trim().to_string();
    if name.is_empty() {
        name = fallback.into();
    }
    let device = name.split('.').next().unwrap_or("").to_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&device.as_str())
    {
        name.insert(0, '_');
    }
    name
}
fn names_in(path: &Path) -> Result<HashSet<String>, String> {
    if !path.exists() {
        return Ok(HashSet::new());
    }
    fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .map(|entry| {
            entry
                .map(|e| e.file_name().to_string_lossy().to_lowercase())
                .map_err(|e| e.to_string())
        })
        .collect()
}
fn allocate(base: &str, extension: &str, used: &mut HashSet<String>) -> String {
    for number in 1.. {
        let name = if number == 1 {
            format!("{base}{extension}")
        } else {
            format!("{base} ({number}){extension}")
        };
        if used.insert(name.to_lowercase()) {
            return name;
        }
    }
    unreachable!()
}
fn layout(root: &Path, workspace: &Workspace, old: Option<&Snapshot>) -> Result<Index, String> {
    workspace.validate()?;
    let mut directories = names_in(root)?;
    let mut clusters = Vec::new();
    for folder in &workspace.clusters {
        let previous = old.and_then(|s| s.index.clusters.iter().find(|c| c.id == folder.id));
        let directory = if let Some(p) = previous.filter(|p| p.name == folder.name) {
            p.directory.clone()
        } else {
            allocate(&stem(&folder.name, "未命名夹"), "", &mut directories)
        };
        let mut used = names_in(&resolve(root, &directory)?)?;
        // Reserve existing names before assigning new notes, so a new title never steals another note's path.
        if let Some(p) = previous {
            for n in &p.notes {
                used.insert(n.file.to_lowercase());
            }
        }
        let mut notes = Vec::new();
        for note in &folder.notes {
            let old_note = previous.and_then(|p| p.notes.iter().find(|n| n.id == note.id));
            let file = if let Some(n) = old_note.filter(|n| n.title == note.title) {
                n.file.clone()
            } else {
                allocate(&stem(&note.title, "未命名便签"), ".md", &mut used)
            };
            notes.push(NoteEntry {
                id: note.id.clone(),
                title: note.title.clone(),
                file,
                color: note.color.clone(),
                updated_at: note.updated_at,
            });
        }
        clusters.push(FolderEntry {
            id: folder.id.clone(),
            name: folder.name.clone(),
            directory,
            icon: folder.icon.clone(),
            color: folder.color.clone(),
            notes,
        });
    }
    let index = Index {
        version: 3,
        revision: old.map_or(1, |s| s.index.revision.saturating_add(1)),
        clusters,
    };
    validate_index(&index)?;
    Ok(index)
}
fn backup_key(id: &str) -> String {
    id.as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn plan(
    root: &Path,
    workspace: &Workspace,
    old: Option<&Snapshot>,
) -> Result<(Index, Journal), String> {
    let index = layout(root, workspace, old)?;
    let mut desired: BTreeMap<String, Option<Vec<u8>>> = BTreeMap::new();
    if let Some(old) = old {
        for (path, bytes) in &old.files {
            if path != INDEX {
                desired.insert(path.clone(), None);
            } else {
                desired.insert(".desktodo/backup/index.json".into(), Some(bytes.clone()));
            }
        }
        for folder in &old.index.clusters {
            for note in &folder.notes {
                let original = &old.files[&format!("{}/{}", folder.directory, note.file)];
                let next = workspace
                    .clusters
                    .iter()
                    .flat_map(|f| &f.notes)
                    .find(|n| n.id == note.id);
                if next.is_none_or(|n| n.content.as_bytes() != original) {
                    let kind = if next.is_some() { "backup" } else { "deleted" };
                    desired.insert(
                        format!(".desktodo/{kind}/{}.md", backup_key(&note.id)),
                        Some(original.clone()),
                    );
                }
            }
        }
    }
    for (folder, data) in index.clusters.iter().zip(&workspace.clusters) {
        for (entry, note) in folder.notes.iter().zip(&data.notes) {
            desired.insert(
                format!("{}/{}", folder.directory, entry.file),
                Some(note.content.as_bytes().to_vec()),
            );
        }
    }
    desired.insert(INDEX.into(), Some(json(&index)?));
    let mut changes = Vec::new();
    for (path, after) in desired {
        let before = read_optional(&resolve(root, &path)?)?;
        if let Some(expected) = old.and_then(|s| s.files.get(&path)) {
            if before.as_ref() != Some(expected) {
                return Err(CONFLICT.into());
            }
        } else if !path.starts_with(".desktodo/") && before.is_some() {
            return Err(format!("{CONFLICT}\n{path}"));
        }
        if before != after {
            changes.push(Change {
                path,
                before,
                after,
            });
        }
    }
    // The index is the commit marker, written only after every Markdown file and backup is ready.
    changes.sort_by_key(|c| c.path == INDEX);
    let directories = index
        .clusters
        .iter()
        .filter(|f| !root.join(&f.directory).exists())
        .map(|f| f.directory.clone())
        .collect();
    Ok((
        index,
        Journal {
            changes,
            directories,
        },
    ))
}
fn apply(root: &Path, relative: &str, bytes: &Option<Vec<u8>>) -> Result<(), String> {
    let path = resolve(root, relative)?;
    if let Some(bytes) = bytes {
        atomic_write(&path, bytes)
    } else {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}
fn valid_change(path: &str) -> bool {
    let parts: Vec<_> = path.split('/').collect();
    if path == INDEX || path == ".desktodo/backup/index.json" {
        return true;
    }
    if parts.len() == 2 {
        return component(parts[0])
            && !parts[0].starts_with('.')
            && component(parts[1])
            && parts[1].ends_with(".md");
    }
    parts.len() == 3
        && parts[0] == ".desktodo"
        && ["backup", "deleted"].contains(&parts[1])
        && component(parts[2])
        && parts[2].ends_with(".md")
}
fn recover(root: &Path) -> Result<(), String> {
    let Some(bytes) = read_optional(&resolve(root, JOURNAL)?)? else {
        return Ok(());
    };
    let journal: Journal =
        serde_json::from_slice(&bytes).map_err(|e| format!("恢复记录损坏：{e}"))?;
    if journal.changes.iter().any(|c| !valid_change(&c.path))
        || journal
            .directories
            .iter()
            .any(|d| !component(d) || d.starts_with('.'))
    {
        return Err("恢复记录包含无效文件路径".into());
    }
    let committed = journal
        .changes
        .last()
        .filter(|c| c.path == INDEX)
        .is_some_and(|c| read_optional(&root.join(INDEX)).ok().as_ref() == Some(&c.after));
    if !committed {
        // Never overwrite a file changed externally after an interrupted transaction.
        for change in &journal.changes {
            let current = read_optional(&resolve(root, &change.path)?)?;
            if current != change.before && current != change.after {
                return Err(format!(
                    "恢复期间发现外部修改：{}。请先保留文件副本。",
                    change.path
                ));
            }
        }
        for change in journal.changes.iter().rev() {
            apply(root, &change.path, &change.before)?;
        }
        for dir in &journal.directories {
            let _ = fs::remove_dir(resolve(root, dir)?);
        }
    }
    fs::remove_file(resolve(root, JOURNAL)?).map_err(|e| e.to_string())
}
fn transact(root: &Path, journal: &Journal) -> Result<(), String> {
    if journal.changes.is_empty() {
        return Ok(());
    }
    atomic_write(&resolve(root, JOURNAL)?, &json(journal)?)?;
    for dir in &journal.directories {
        if let Err(error) = fs::create_dir_all(resolve(root, dir)?) {
            recover(root)?;
            return Err(error.to_string());
        }
    }
    for change in &journal.changes {
        let result = (|| {
            if read_optional(&resolve(root, &change.path)?)? != change.before {
                return Err(CONFLICT.into());
            }
            apply(root, &change.path, &change.after)
        })();
        if let Err(error) = result {
            return match recover(root) {
                Ok(()) => Err(error),
                Err(recovery) => Err(format!("{error}\n{recovery}")),
            };
        }
    }
    // If cleanup fails, recover() recognizes the committed index on next access.
    let _ = fs::remove_file(resolve(root, JOURNAL)?);
    Ok(())
}
fn write_inner(
    root: &Path,
    workspace: &Workspace,
    old: Option<&Snapshot>,
) -> Result<Snapshot, String> {
    let (index, journal) = plan(root, workspace, old)?;
    transact(root, &journal)?;
    if let Some(old) = old {
        for folder in &old.index.clusters {
            if !index
                .clusters
                .iter()
                .any(|f| f.directory == folder.directory)
            {
                // Remove only an empty old folder. Unmanaged attachments are left intact.
                let _ = fs::remove_dir(resolve(root, &folder.directory)?);
            }
        }
    }
    // Keep the exact bytes we committed as the comparison baseline. Reading back here
    // could silently adopt an external edit the frontend has never seen.
    let mut files = BTreeMap::from([(INDEX.into(), json(&index)?)]);
    for (folder, data) in index.clusters.iter().zip(&workspace.clusters) {
        for (entry, note) in folder.notes.iter().zip(&data.notes) {
            files.insert(
                format!("{}/{}", folder.directory, entry.file),
                note.content.as_bytes().to_vec(),
            );
        }
    }
    Ok(Snapshot {
        workspace: workspace.clone(),
        index,
        files,
    })
}
fn load_inner(root: &Path) -> Result<Snapshot, String> {
    recover(root)?;
    if resolve(root, INDEX)?.exists() {
        return read_current(root);
    }
    let legacy = resolve(root, "workspace.json")?;
    let bytes = fs::read(legacy).map_err(|e| format!("找不到 DeskTodo 数据：{e}"))?;
    let workspace: Workspace = serde_json::from_slice(&bytes)
        .map_err(|e| format!("旧版便签格式错误：{e}。原文件已保留。"))?;
    workspace.validate()?;
    // Legacy JSON and its .bak remain untouched. The new index is installed last.
    write_inner(root, &workspace, None)
}
pub fn load(root: &Path) -> Result<Snapshot, String> {
    if !root.is_dir() {
        return Err("数据目录不存在".into());
    }
    let _lock = lock_dir(root)?;
    load_inner(root)
}
pub fn prepare(root: &Path, seed: &Workspace) -> Result<Snapshot, String> {
    if !root.is_absolute() {
        return Err("请选择绝对路径".into());
    }
    seed.validate()?;
    let existing = resolve(root, INDEX)?.exists()
        || resolve(root, "workspace.json")?.exists()
        || resolve(root, JOURNAL)?.exists();
    let names = names_in(root)?;
    let only_lock = names.len() == 1
        && names.contains(".desktodo")
        && names_in(&resolve(root, ".desktodo")?)?
            .iter()
            .all(|n| n == "write.lock");
    if !existing && !names.is_empty() && !only_lock {
        return Err("请选择空目录或已有 DeskTodo 数据的目录。现有文件不会被覆盖。".into());
    }
    let _lock = lock_dir(root)?;
    recover(root)?;
    if resolve(root, INDEX)?.exists() || resolve(root, "workspace.json")?.exists() {
        load_inner(root)
    } else {
        write_inner(root, seed, None)
    }
}
pub fn save(root: &Path, workspace: &Workspace, expected: &Snapshot) -> Result<Snapshot, String> {
    let _lock = lock_dir(root)?;
    recover(root)?;
    let current = read_current(root)?;
    if current.files != expected.files {
        return Err(CONFLICT.into());
    }
    write_inner(root, workspace, Some(&current))
}
pub fn note_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    let _lock = lock_dir(root)?;
    recover(root)?;
    let snapshot = read_current(root)?;
    for folder in snapshot.index.clusters {
        if let Some(note) = folder.notes.iter().find(|n| n.id == id) {
            return resolve(root, &format!("{}/{}", folder.directory, note.file));
        }
    }
    Err("找不到此便签文件".into())
}
pub fn preserve_draft(root: &Path, workspace: &Workspace) -> Result<PathBuf, String> {
    workspace.validate()?;
    let _lock = lock_dir(root)?;
    let parent = resolve(root, ".desktodo/drafts")?;
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let draft = tempfile::Builder::new()
        .prefix("未保存副本-")
        .tempdir_in(&parent)
        .map_err(|e| e.to_string())?
        .keep();
    write_inner(&draft, workspace, None)?;
    Ok(draft)
}

#[cfg(test)]
mod tests;
