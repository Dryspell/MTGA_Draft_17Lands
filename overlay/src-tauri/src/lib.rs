use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent};

const BRIDGE_ADDR: &str = "127.0.0.1:8617";

/// The Python engine process. It is started with `--watch-stdin` and exits when
/// we close its stdin, so it cannot outlive the overlay even if we crash.
enum Bridge {
  #[cfg(not(debug_assertions))]
  Sidecar(tauri_plugin_shell::process::CommandChild),
  #[cfg(debug_assertions)]
  Dev(std::process::Child),
}

impl Bridge {
  fn kill(self) {
    match self {
      #[cfg(not(debug_assertions))]
      Bridge::Sidecar(child) => {
        let _ = child.kill();
      }
      #[cfg(debug_assertions)]
      Bridge::Dev(mut child) => {
        let _ = child.kill();
      }
    }
  }
}

struct BridgeState(Mutex<Option<Bridge>>);

fn bridge_running() -> bool {
  TcpStream::connect_timeout(&BRIDGE_ADDR.parse().unwrap(), Duration::from_millis(300)).is_ok()
}

#[cfg(debug_assertions)]
fn spawn_bridge(_app: &AppHandle) -> Result<Bridge, Box<dyn std::error::Error>> {
  let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize()?;
  let python = if cfg!(windows) {
    root.join(".venv/Scripts/python.exe")
  } else {
    root.join(".venv/bin/python")
  };
  let child = std::process::Command::new(python)
    .args(["-m", "bridge", "--watch-stdin"])
    .current_dir(&root)
    .stdin(std::process::Stdio::piped())
    .spawn()?;
  Ok(Bridge::Dev(child))
}

#[cfg(not(debug_assertions))]
fn spawn_bridge(app: &AppHandle) -> Result<Bridge, Box<dyn std::error::Error>> {
  use tauri_plugin_shell::ShellExt;
  let home = app.path().app_data_dir()?;
  std::fs::create_dir_all(&home)?;
  let (mut events, child) = app
    .shell()
    .sidecar("mtga-bridge")?
    .args(["--watch-stdin"])
    .env("MTGA_DRAFT_TOOL_HOME", home)
    .spawn()?;
  // Drain output so the pipes never fill and block the engine.
  tauri::async_runtime::spawn(async move { while events.recv().await.is_some() {} });
  Ok(Bridge::Sidecar(child))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(BridgeState(Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      if bridge_running() {
        log::info!("Using already running bridge at {BRIDGE_ADDR}");
      } else {
        match spawn_bridge(app.handle()) {
          Ok(bridge) => *app.state::<BridgeState>().0.lock().unwrap() = Some(bridge),
          Err(e) => log::error!("Failed to start bridge: {e}"),
        }
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|handle, event| {
    if let RunEvent::Exit = event {
      if let Some(bridge) = handle.state::<BridgeState>().0.lock().unwrap().take() {
        bridge.kill();
      }
    }
  });
}
