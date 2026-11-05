use super::*;

fn seed() -> Workspace {
    Workspace {
        clusters: vec![Cluster {
            id: "inbox".into(),
            name: "收件箱".into(),
            icon: "folder".into(),
            color: "#8fa9f7".into(),
            notes: vec![Note {
                id: "note".into(),
                title: "随手记".into(),
                content: "# 中文笔记\n\n```todo\n- [ ] 完成迁移\n```\n".into(),
                color: "#8fa9f7".into(),
                updated_at: 1,
            }],
        }],
    }
}
fn body(snapshot: &Snapshot) -> &str {
    &snapshot.workspace.clusters[0].notes[0].content
}

#[test]
fn plain_markdown_roundtrip_and_metadata_has_no_content() {
    let root = tempfile::tempdir().unwrap();
    let original = seed();
    let first = prepare(root.path(), &original).unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("收件箱/随手记.md")).unwrap(),
        body(&first)
    );
    let metadata = fs::read_to_string(root.path().join(INDEX)).unwrap();
    assert!(!metadata.contains("content"));
    assert!(!metadata.contains("完成迁移"));
    let mut updated = original.clone();
    updated.clusters[0].notes[0].content = "# 新内容\r\n\r\n无额外 frontmatter".into();
    let second = save(root.path(), &updated, &first).unwrap();
    assert_eq!(body(&second), updated.clusters[0].notes[0].content);
    assert_eq!(
        fs::read_to_string(
            root.path()
                .join(format!(".desktodo/backup/{}.md", backup_key("note")))
        )
        .unwrap(),
        body(&first)
    );
    assert_eq!(body(&load(root.path()).unwrap()), body(&second));
}

#[test]
fn legacy_migration_is_lossless_idempotent_and_keeps_originals() {
    let root = tempfile::tempdir().unwrap();
    let old = json(&seed()).unwrap();
    fs::write(root.path().join("workspace.json"), &old).unwrap();
    fs::write(root.path().join("workspace.json.bak"), b"older backup").unwrap();
    // An unrelated pre-existing folder and same name file must not be overwritten.
    fs::create_dir(root.path().join("收件箱")).unwrap();
    fs::write(root.path().join("收件箱/随手记.md"), "unmanaged").unwrap();
    let migrated = load(root.path()).unwrap();
    assert_eq!(migrated.index.clusters[0].directory, "收件箱 (2)");
    assert_eq!(body(&migrated), seed().clusters[0].notes[0].content);
    let again = load(root.path()).unwrap();
    assert_eq!(migrated.files, again.files);
    assert_eq!(fs::read(root.path().join("workspace.json")).unwrap(), old);
    assert_eq!(
        fs::read(root.path().join("workspace.json.bak")).unwrap(),
        b"older backup"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("收件箱/随手记.md")).unwrap(),
        "unmanaged"
    );
}

#[test]
fn duplicate_reserved_and_unsafe_names_are_portable() {
    let root = tempfile::tempdir().unwrap();
    let mut data = seed();
    data.clusters[0].name = "../CON".into();
    data.clusters[0].notes[0].title = "A/B:*?".into();
    let mut duplicate = data.clusters[0].notes[0].clone();
    duplicate.id = "two".into();
    duplicate.title = "a/b:*?".into();
    data.clusters[0].notes.push(duplicate);
    let mut folder = data.clusters[0].clone();
    folder.id = "second-folder".into();
    folder.notes.clear();
    data.clusters.push(folder);
    let snapshot = prepare(root.path(), &data).unwrap();
    let first = &snapshot.index.clusters[0];
    assert!(!first.directory.contains('/'));
    assert_ne!(
        first.directory.to_lowercase(),
        snapshot.index.clusters[1].directory.to_lowercase()
    );
    assert_ne!(
        first.notes[0].file.to_lowercase(),
        first.notes[1].file.to_lowercase()
    );
    assert_eq!(stem("CON.txt", "note"), "_CON.txt");
    assert_eq!(stem("...", "note"), "note");
    assert!(stem(&"文".repeat(400), "note").chars().count() <= 64);
    assert_eq!(
        load(root.path()).unwrap().workspace.clusters[0].name,
        "../CON"
    );
}

#[test]
fn rename_moves_markdown_and_delete_keeps_recoverable_copy() {
    let root = tempfile::tempdir().unwrap();
    let first = prepare(root.path(), &seed()).unwrap();
    fs::write(root.path().join("收件箱/attachment.txt"), "keep").unwrap();
    let mut data = first.workspace.clone();
    data.clusters[0].name = "我的工作".into();
    data.clusters[0].notes[0].title = "下一步".into();
    let renamed = save(root.path(), &data, &first).unwrap();
    assert!(root.path().join("我的工作/下一步.md").exists());
    assert!(!root.path().join("收件箱/随手记.md").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("收件箱/attachment.txt")).unwrap(),
        "keep"
    );
    data.clusters[0].notes.clear();
    let deleted = save(root.path(), &data, &renamed).unwrap();
    assert!(!root.path().join("我的工作/下一步.md").exists());
    assert!(root.path().join("我的工作").is_dir());
    assert!(deleted.workspace.clusters[0].notes.is_empty());
    assert_eq!(
        fs::read_to_string(
            root.path()
                .join(format!(".desktodo/deleted/{}.md", backup_key("note")))
        )
        .unwrap(),
        body(&first)
    );
}

#[test]
fn external_edits_are_read_and_never_silently_overwritten() {
    let root = tempfile::tempdir().unwrap();
    let first = prepare(root.path(), &seed()).unwrap();
    let path = root.path().join("收件箱/随手记.md");
    fs::write(&path, "# 来自 Typora 的修改").unwrap();
    let mut local = first.workspace.clone();
    local.clusters[0].notes[0].content = "# 应用内未保存的版本".into();
    assert!(save(root.path(), &local, &first)
        .err()
        .unwrap()
        .contains("外部修改"));
    assert_eq!(fs::read_to_string(&path).unwrap(), "# 来自 Typora 的修改");
    let draft = preserve_draft(root.path(), &local).unwrap();
    assert_eq!(body(&load(&draft).unwrap()), "# 应用内未保存的版本");
    let external = load(root.path()).unwrap();
    assert_eq!(body(&external), "# 来自 Typora 的修改");
    fs::remove_file(&path).unwrap();
    assert!(save(root.path(), &local, &external).is_err());
    assert!(!path.exists());
}

#[test]
fn interrupted_save_rolls_back_and_committed_save_does_not_overwrite_later_edits() {
    let root = tempfile::tempdir().unwrap();
    let first = prepare(root.path(), &seed()).unwrap();
    let mut update = first.workspace.clone();
    update.clusters[0].notes[0].content = "new".into();
    update.clusters[0].notes[0].updated_at = 2;
    let (_, journal) = plan(root.path(), &update, Some(&first)).unwrap();
    atomic_write(&root.path().join(JOURNAL), &json(&journal).unwrap()).unwrap();
    for change in journal.changes.iter().filter(|c| c.path != INDEX) {
        apply(root.path(), &change.path, &change.after).unwrap();
    }
    assert_eq!(body(&load(root.path()).unwrap()), body(&first));
    atomic_write(&root.path().join(JOURNAL), &json(&journal).unwrap()).unwrap();
    for change in &journal.changes {
        apply(root.path(), &change.path, &change.after).unwrap();
    }
    fs::write(root.path().join("收件箱/随手记.md"), "changed after commit").unwrap();
    assert_eq!(body(&load(root.path()).unwrap()), "changed after commit");
    assert!(!root.path().join(JOURNAL).exists());
}

#[test]
fn interrupted_creation_can_be_retried() {
    let root = tempfile::tempdir().unwrap();
    let (_, journal) = plan(root.path(), &seed(), None).unwrap();
    atomic_write(&root.path().join(JOURNAL), &json(&journal).unwrap()).unwrap();
    for folder in &journal.directories {
        fs::create_dir_all(root.path().join(folder)).unwrap();
    }
    for change in journal.changes.iter().filter(|c| c.path != INDEX) {
        apply(root.path(), &change.path, &change.after).unwrap();
    }
    let loaded = prepare(root.path(), &seed()).unwrap();
    assert_eq!(loaded.index.clusters[0].directory, "收件箱");
}

#[test]
fn corrupt_unrelated_and_traversal_data_are_rejected() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("other.txt"), "keep").unwrap();
    assert!(prepare(root.path(), &seed()).is_err());
    fs::write(root.path().join("workspace.json"), b"{ broken").unwrap();
    assert!(load(root.path()).is_err());
    assert_eq!(
        fs::read_to_string(root.path().join("workspace.json")).unwrap(),
        "{ broken"
    );
    let fresh = tempfile::tempdir().unwrap();
    let first = prepare(fresh.path(), &seed()).unwrap();
    let mut index = first.index;
    index.clusters[0].directory = "../outside".into();
    fs::write(fresh.path().join(INDEX), json(&index).unwrap()).unwrap();
    assert!(load(fresh.path()).is_err());
    assert!(resolve(fresh.path(), "../outside/file.md").is_err());
    assert!(!valid_change(".desktodo/../../outside.md"));
    assert!(prepare(Path::new("relative"), &seed()).is_err());
}

#[test]
fn competing_writer_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let first = prepare(root.path(), &seed()).unwrap();
    let held = lock_dir(root.path()).unwrap();
    assert!(save(root.path(), &first.workspace, &first)
        .err()
        .unwrap()
        .contains("另一个"));
    drop(held);
    assert!(load(root.path()).is_ok());
}
