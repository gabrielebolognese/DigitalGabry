use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{Manager, WindowEvent};

/* SPEC 2 asks for custom Rust near zero, and these commands are the exception.
   Backups and export write to folders the user picks, which the fs plugin's
   scope model makes awkward, and committing the export needs a git process
   that no plugin in SPEC 2's list provides. Phase 11 adds three more for the
   asset vault, which writes image bytes rather than text. */

fn to_message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(to_message)
}

#[tauri::command]
fn write_text_file(dir: String, name: String, contents: String) -> Result<(), String> {
    fs::create_dir_all(&dir).map_err(to_message)?;
    fs::write(Path::new(&dir).join(name), contents).map_err(to_message)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(to_message)
}

/// Writes an asset into the vault. Separate from `write_text_file` because
/// image bytes are not a String, and round-tripping them through one would
/// corrupt anything that is not valid UTF-8.
#[tauri::command]
fn write_binary_file(dir: String, name: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::create_dir_all(&dir).map_err(to_message)?;
    fs::write(Path::new(&dir).join(name), bytes).map_err(to_message)
}

/// True when the path already exists, so an import that deduplicates on hash
/// can skip the copy without reading the file back.
#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Deletes files older than `max_age_ms` from a directory, non-recursively.
/// Used to keep the outbox from growing without bound.
#[tauri::command]
fn prune_older_than(dir: String, max_age_ms: u64) -> Result<usize, String> {
    let path = PathBuf::from(&dir);
    if !path.exists() {
        return Ok(0);
    }

    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_millis(max_age_ms))
        .ok_or_else(|| "Age is further back than the system clock reaches".to_string())?;

    let mut removed = 0;
    for entry in fs::read_dir(&path).map_err(to_message)? {
        let entry = entry.map_err(to_message)?;
        if !entry.file_type().map_err(to_message)?.is_file() {
            continue;
        }
        let modified = entry.metadata().map_err(to_message)?.modified().map_err(to_message)?;
        if modified < cutoff {
            fs::remove_file(entry.path()).map_err(to_message)?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Deletes the oldest snapshots beyond `keep`. Names are dated and sort
/// lexicographically, so ordering by name orders by age.
#[tauri::command]
fn prune_snapshots(dir: String, keep: usize) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&dir);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let mut snapshots: Vec<String> = fs::read_dir(&path)
        .map_err(to_message)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.starts_with("digitalgabry-") && name.ends_with(".db"))
        .collect();

    snapshots.sort();

    let mut removed = Vec::new();
    if snapshots.len() > keep {
        for name in &snapshots[..snapshots.len() - keep] {
            if fs::remove_file(path.join(name)).is_ok() {
                removed.push(name.clone());
            }
        }
    }
    Ok(removed)
}

/// Stages and commits the export folder. Silently reports "not a repository"
/// when there is no .git, per SPEC 11.
#[tauri::command]
fn git_commit_export(dir: String, message: String) -> Result<String, String> {
    let path = PathBuf::from(&dir);
    if !path.join(".git").exists() {
        return Ok("not a repository".into());
    }

    let add = Command::new("git")
        .args(["add", "-A"])
        .current_dir(&path)
        .output()
        .map_err(to_message)?;
    if !add.status.success() {
        return Err(String::from_utf8_lossy(&add.stderr).trim().to_string());
    }

    let commit = Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&path)
        .output()
        .map_err(to_message)?;

    if commit.status.success() {
        return Ok("committed".into());
    }

    // An unchanged export is the expected steady state, not a failure.
    let stdout = String::from_utf8_lossy(&commit.stdout);
    if stdout.contains("nothing to commit") {
        return Ok("nothing to commit".into());
    }
    Err(String::from_utf8_lossy(&commit.stderr).trim().to_string())
}

const MAIN_WINDOW: &str = "main";
const CAPTURE_WINDOW: &str = "capture";

fn show_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Both windows are declared in tauri.conf.json rather than created on demand.
/// The capture window is built hidden at startup so the global shortcut only
/// has to show and focus it, which is what keeps it inside the 200ms budget;
/// spawning a webview on the keypress would spend most of that booting one.
#[cfg(desktop)]
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Quick capture", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &capture, &quit])?;

    let mut tray = TrayIconBuilder::with_id("digitalgabry-tray")
        .tooltip("DigitalGabry")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app, MAIN_WINDOW),
            "capture" => show_window(app, CAPTURE_WINDOW),
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        // The API key lives in the OS app data directory via the store, never
        // in the database and never in the repository. SPEC 9.
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ensure_dir,
            write_text_file,
            write_binary_file,
            read_text_file,
            path_exists,
            prune_older_than,
            prune_snapshots,
            git_commit_export
        ]);

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        .setup(|_app| {
            #[cfg(desktop)]
            build_tray(_app.handle())?;
            Ok(())
        })
        // Closing the main window hides it instead of quitting, which is what
        // makes the tray meaningful. Quit is reachable from the tray menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    MAIN_WINDOW => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    CAPTURE_WINDOW => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
