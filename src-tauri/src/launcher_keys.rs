use global_hotkey::hotkey::HotKey as Shortcut;

use rusqlite::{Connection, OptionalExtension};

const KEY: &str = "quick_launcher_shortcut";
pub(super) fn read_saved(db: &Connection) -> rusqlite::Result<String> {
    let saved = db
        .query_row("SELECT value FROM app_settings WHERE key=?", [KEY], |r| {
            r.get::<_, String>(0)
        })
        .optional()?;
    let default = if cfg!(target_os = "macos") {
        "Command+Shift+."
    } else {
        "Control+Shift+."
    };
    Ok(saved
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(default)
        .to_owned())
}
pub(super) fn store(db: &Connection, text: &str) -> rusqlite::Result<()> {
    db.execute("INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[KEY,text])?;
    Ok(())
}

pub(super) fn parse(text: &str) -> Result<Shortcut, String> {
    let mut parts = text.split('+').map(str::trim).collect::<Vec<_>>();
    let key = parts.pop().unwrap_or("");
    if parts.is_empty()
        && !key
            .strip_prefix(['F', 'f'])
            .and_then(|n| n.parse::<u8>().ok())
            .is_some_and(|n| (1..=24).contains(&n))
    {
        return Err("Hãy chọn phím bổ trợ hoặc phím chức năng.".into());
    }
    let mut keys = Vec::new();
    for p in parts {
        let modifier = match p.to_ascii_lowercase().as_str() {
            "cmd" | "command" | "super" | "meta" => "Super",
            "ctrl" | "control" => "Control",
            "alt" | "option" => "Alt",
            "shift" => "Shift",
            "cmdorctrl" | "commandorcontrol" => {
                if cfg!(target_os = "macos") {
                    "Super"
                } else {
                    "Control"
                }
            }
            _ => return Err(format!("Phím bổ trợ không hợp lệ: {p}")),
        };
        if !keys.contains(&modifier) {
            keys.push(modifier);
        }
    }
    keys.push(match key {
        "." => "Period",
        "," => "Comma",
        "/" => "Slash",
        ";" => "Semicolon",
        "'" => "Quote",
        "[" => "BracketLeft",
        "]" => "BracketRight",
        "\\" => "Backslash",
        "-" => "Minus",
        "=" => "Equal",
        "`" => "Backquote",
        _ => key,
    });
    keys.join("+")
        .parse::<Shortcut>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_electron_setting_and_persists_change_across_restart() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("library.db");
        let db = Connection::open(&file).unwrap();
        db.execute_batch("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            .unwrap();
        assert!(parse(&read_saved(&db).unwrap()).is_ok());
        db.execute(
            "INSERT INTO app_settings VALUES('quick_launcher_shortcut',' CmdOrCtrl+Shift+, ')",
            [],
        )
        .unwrap();
        assert_eq!(read_saved(&db).unwrap(), "CmdOrCtrl+Shift+,");
        store(&db, "Alt+F9").unwrap();
        drop(db);
        assert_eq!(
            read_saved(&Connection::open(file).unwrap()).unwrap(),
            "Alt+F9"
        );
    }
    #[test]
    fn legacy_accelerators_and_function_keys() {
        for (alias, canonical) in [
            ("ctrl+shift+.", "Control+Shift+Period"),
            ("Option+/", "Alt+Slash"),
            ("Cmd+K", "Super+KeyK"),
            ("F12", "F12"),
            ("Ctrl+Ctrl+,", "Control+Comma"),
        ] {
            assert_eq!(
                parse(alias).unwrap(),
                canonical.parse::<Shortcut>().unwrap()
            );
        }
        for invalid in ["", "A", "Ctrl+", "F25", "Alt+unknown", "unknown+K"] {
            assert!(parse(invalid).is_err(), "{invalid}");
        }
    }
}
