use tauri::{Manager, WindowEvent};

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
        .plugin(tauri_plugin_store::Builder::new().build());

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
