mod api_client;
mod db;
mod watch_engine;

use api_client::{ApiClient, BatchFile, Template};
use db::{Database, ProfileRow};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;

// ============================================================
// App State (SQLite-backed)
// ============================================================

pub struct AppState {
    pub db: Database,
    api_client: Mutex<Option<ApiClient>>,
    stop_flags: Mutex<HashMap<String, Arc<Mutex<bool>>>>,
}

fn get_client(state: &AppState) -> Result<ApiClient, String> {
    state.api_client.lock().unwrap_or_else(|e| e.into_inner()).as_ref().cloned().ok_or_else(|| "API未接続です".to_string())
}

// ============================================================
// Types
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatchProfile {
    id: String, name: String, template_id: String, template_name: String,
    input_folder: String, output_folder: String, processed_folder: String,
    csv_encoding: String, output_cycle: String, polling_interval_seconds: u32,
    is_active: bool, created_at: String, updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileFormData {
    name: String, template_id: String, template_name: String,
    input_folder: String, output_folder: String, processed_folder: String,
    csv_encoding: String, output_cycle: String, polling_interval_seconds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessingLogEntry {
    id: i64, profile_id: String, profile_name: String, file_name: String,
    status: String, job_id: String, result_count: u32, processing_time_ms: u64,
    error: Option<String>, created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractFileResult {
    file_name: String, status: String, job_id: String,
    result_count: u32, processing_time_ms: u64, error: Option<String>,
}

// ============================================================
// Keyring (OS Credential Manager)
// ============================================================

const KEYRING_SERVICE: &str = "com.kamitoru.desktop";
const KEYRING_USER: &str = "api-key";

/// APIキーをOS資格情報マネージャーに保存
fn save_api_key_to_keyring(api_key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Keyring初期化エラー: {}", e))?;
    entry.set_password(api_key)
        .map_err(|e| format!("Keyring保存エラー: {}", e))?;
    println!("[Keyring] APIキーを保存しました");
    Ok(())
}

/// OS資格情報マネージャーからAPIキーを取得
fn load_api_key_from_keyring() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
    match entry.get_password() {
        Ok(key) if !key.is_empty() => {
            println!("[Keyring] APIキーを読み込みました");
            Some(key)
        }
        _ => None,
    }
}

/// OS資格情報マネージャーからAPIキーを削除
fn delete_api_key_from_keyring() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
        println!("[Keyring] APIキーを削除しました");
    }
}

// ============================================================
// Connection (API Key + SQLite persistence)
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionConfig { api_url: String, api_key: String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionTestResult { success: bool, templates: Vec<Template>, error: Option<String> }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedSession { connected: bool, api_url: String, has_api_key: bool }

#[tauri::command]
async fn test_connection(config: ConnectionConfig, state: State<'_, AppState>) -> Result<ConnectionTestResult, String> {
    let client = ApiClient::new(&config.api_url, &config.api_key);
    match client.test_connection().await {
        Ok(templates) => {
            // Always save to DB (reliable), also try keyring (more secure)
            state.db.save_connection(&config.api_url, &config.api_key, "", "", "", "", "")?;
            let _ = save_api_key_to_keyring(&config.api_key);
            *state.api_client.lock().unwrap_or_else(|e| e.into_inner()) = Some(client);
            println!("[Connection] Connected: {} templates", templates.len());
            Ok(ConnectionTestResult { success: true, templates, error: None })
        }
        Err(e) => Ok(ConnectionTestResult { success: false, templates: vec![], error: Some(e) }),
    }
}

#[tauri::command]
async fn check_saved_session(state: State<'_, AppState>) -> Result<SavedSession, String> {
    let conn = state.db.load_connection()?;
    let api_url = conn.api_url;
    // APIキーはkeyringから優先取得、なければDBのフォールバック
    let api_key = load_api_key_from_keyring().unwrap_or(conn.api_key);
    if api_url.is_empty() || api_key.is_empty() {
        return Ok(SavedSession { connected: false, api_url: String::new(), has_api_key: false });
    }
    let client = ApiClient::new(&api_url, &api_key);
    match client.get_templates().await {
        Ok(_) => {
            *state.api_client.lock().unwrap_or_else(|e| e.into_inner()) = Some(client);
            println!("[Connection] Auto-reconnected");
            Ok(SavedSession { connected: true, api_url, has_api_key: !api_key.is_empty() })
        }
        Err(e) => {
            println!("[Connection] Auto-reconnect failed: {}", e);
            Ok(SavedSession { connected: false, api_url, has_api_key: !api_key.is_empty() })
        }
    }
}

#[tauri::command]
fn logout(state: State<'_, AppState>) -> Result<(), String> {
    let mut flags = state.stop_flags.lock().unwrap_or_else(|e| e.into_inner());
    for (_, flag) in flags.drain() { *flag.lock().unwrap_or_else(|e| e.into_inner()) = true; }
    *state.api_client.lock().unwrap_or_else(|e| e.into_inner()) = None;
    state.db.clear_connection()?;
    delete_api_key_from_keyring();
    println!("[Connection] Disconnected");
    Ok(())
}

#[tauri::command]
async fn fetch_templates(state: State<'_, AppState>) -> Result<Vec<Template>, String> {
    get_client(&state)?.get_templates().await
}

// ============================================================
// Profile CRUD (SQLite-backed)
// ============================================================

fn row_to_profile(r: &ProfileRow) -> WatchProfile {
    WatchProfile {
        id: r.id.clone(), name: r.name.clone(), template_id: r.template_id.clone(),
        template_name: r.template_name.clone(), input_folder: r.input_folder.clone(),
        output_folder: r.output_folder.clone(), processed_folder: r.processed_folder.clone(),
        csv_encoding: r.csv_encoding.clone(), output_cycle: r.output_cycle.clone(),
        polling_interval_seconds: r.polling_interval_seconds,
        is_active: r.is_active, created_at: r.created_at.clone(), updated_at: r.updated_at.clone(),
    }
}

#[tauri::command]
fn get_profiles(state: State<'_, AppState>) -> Result<Vec<WatchProfile>, String> {
    Ok(state.db.list_profiles()?.iter().map(row_to_profile).collect())
}

#[tauri::command]
fn create_profile(data: ProfileFormData, state: State<'_, AppState>) -> Result<WatchProfile, String> {
    validate_profile(&data)?;
    let now = chrono::Local::now().to_rfc3339();
    let row = ProfileRow {
        id: format!("prof_{}", chrono::Local::now().timestamp_millis()),
        name: data.name, template_id: data.template_id, template_name: data.template_name,
        input_folder: data.input_folder, output_folder: data.output_folder,
        processed_folder: data.processed_folder, csv_encoding: data.csv_encoding,
        output_cycle: data.output_cycle.clone(), polling_interval_seconds: data.polling_interval_seconds, is_active: false,
        created_at: now.clone(), updated_at: now,
    };
    state.db.insert_profile(&row)?;
    Ok(row_to_profile(&row))
}

#[tauri::command]
fn update_profile(id: String, data: ProfileFormData, state: State<'_, AppState>) -> Result<WatchProfile, String> {
    validate_profile(&data)?;
    let now = chrono::Local::now().to_rfc3339();
    let row = ProfileRow {
        id: id.clone(), name: data.name, template_id: data.template_id, template_name: data.template_name,
        input_folder: data.input_folder, output_folder: data.output_folder,
        processed_folder: data.processed_folder, csv_encoding: data.csv_encoding,
        output_cycle: data.output_cycle.clone(), polling_interval_seconds: data.polling_interval_seconds, is_active: false,
        created_at: String::new(), updated_at: now,
    };
    state.db.update_profile(&row)?;
    state.db.list_profiles()?.iter().find(|p| p.id == id).map(row_to_profile).ok_or("見つかりません".into())
}

#[tauri::command]
fn delete_profile(id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(flag) = state.stop_flags.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) { *flag.lock().unwrap_or_else(|e| e.into_inner()) = true; }
    state.db.delete_profile(&id)
}

#[tauri::command]
fn toggle_profile_active(id: String, active: bool, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.db.set_profile_active(&id, active)?;
    let profile = state.db.list_profiles()?.into_iter().find(|p| p.id == id).ok_or("見つかりません")?;
    let mut stop_flags = state.stop_flags.lock().unwrap_or_else(|e| e.into_inner());
    if active {
        let client = get_client(&state)?;
        if let Some(old) = stop_flags.remove(&id) { *old.lock().unwrap_or_else(|e| e.into_inner()) = true; }
        let flag = Arc::new(Mutex::new(false));
        stop_flags.insert(id.clone(), flag.clone());
        watch_engine::start_watcher(app, profile.id, profile.name, profile.template_id,
            profile.input_folder, profile.output_folder, profile.processed_folder,
            profile.csv_encoding, profile.output_cycle, profile.polling_interval_seconds, client, flag);
    } else {
        if let Some(flag) = stop_flags.remove(&id) { *flag.lock().unwrap_or_else(|e| e.into_inner()) = true; }
    }
    Ok(())
}

// ============================================================
// File Validation Helpers
// ============================================================

const MAX_FILE_SIZE: u64 = 100 * 1024 * 1024; // 100MB

/// ファイルパスが.pdf拡張子かどうかを検証
fn validate_pdf_path(path: &std::path::Path) -> Result<(), String> {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("pdf") => Ok(()),
        _ => Err("PDFファイルのみ対応しています".to_string()),
    }
}

/// プロファイル入力データのバリデーション
fn validate_profile(data: &ProfileFormData) -> Result<(), String> {
    if data.name.trim().is_empty() { return Err("プロファイル名は必須です".to_string()); }
    if data.name.len() > 100 { return Err("プロファイル名は100文字以内です".to_string()); }
    if data.input_folder.trim().is_empty() { return Err("入力フォルダは必須です".to_string()); }
    if data.output_folder.trim().is_empty() { return Err("出力フォルダは必須です".to_string()); }
    if data.processed_folder.trim().is_empty() { return Err("処理済みフォルダは必須です".to_string()); }
    if data.polling_interval_seconds < 1 || data.polling_interval_seconds > 3600 {
        return Err("ポーリング間隔は1〜3600秒です".to_string());
    }
    if !["utf-8-bom", "utf-8", "shift_jis"].contains(&data.csv_encoding.as_str()) {
        return Err("無効なCSVエンコーディングです".to_string());
    }
    Ok(())
}

// ============================================================
// Extraction
// ============================================================

#[tauri::command]
async fn extract_file(req: serde_json::Value, state: State<'_, AppState>) -> Result<ExtractFileResult, String> {
    let tid = req["templateId"].as_str().ok_or("templateId required")?.to_string();
    let fp = req["filePath"].as_str().ok_or("filePath required")?.to_string();
    let client = get_client(&state)?;
    let path = PathBuf::from(&fp);
    validate_pdf_path(&path)?;
    let meta = fs::metadata(&path).map_err(|e| format!("メタデータ取得エラー: {}", e))?;
    if meta.len() > MAX_FILE_SIZE {
        return Err(format!("ファイルサイズが上限(100MB)を超えています: {}MB", meta.len() / 1024 / 1024));
    }
    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&fs::read(&path).map_err(|e| format!("読込エラー: {}", e))?);
    match client.extract(&tid, &b64, &name).await {
        Ok(r) => Ok(ExtractFileResult { file_name: name, status: r.status, job_id: r.job_id,
            result_count: r.summary.total_fields, processing_time_ms: r.summary.processing_time_ms, error: None }),
        Err(e) => Ok(ExtractFileResult { file_name: name, status: "FAILED".into(), job_id: String::new(),
            result_count: 0, processing_time_ms: 0, error: Some(e) }),
    }
}

#[tauri::command]
async fn batch_extract(req: serde_json::Value, state: State<'_, AppState>) -> Result<ExtractFileResult, String> {
    let tid = req["templateId"].as_str().ok_or("templateId required")?.to_string();
    let fps: Vec<String> = req["filePaths"].as_array().ok_or("filePaths required")?
        .iter().filter_map(|v| v.as_str().map(String::from)).collect();
    let client = get_client(&state)?;
    let mut files = Vec::new();
    for p in &fps {
        let path = PathBuf::from(p);
        validate_pdf_path(&path)?;
        let meta = fs::metadata(&path).map_err(|e| format!("メタデータ取得エラー: {}", e))?;
        if meta.len() > MAX_FILE_SIZE {
            return Err(format!("ファイルサイズが上限(100MB)を超えています: {}MB ({}) ", meta.len() / 1024 / 1024, p));
        }
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&fs::read(&path).map_err(|e| format!("読込エラー: {}", e))?);
        files.push(BatchFile { pdf_base64: b64, file_name: name });
    }
    let n = files.len() as u32;
    match client.batch_extract(&tid, files, None).await {
        Ok(r) => Ok(ExtractFileResult { file_name: format!("{}files", n), status: r.status, job_id: r.job_id,
            result_count: r.completed_files, processing_time_ms: r.processing_time_ms, error: None }),
        Err(e) => Ok(ExtractFileResult { file_name: format!("{}files", n), status: "FAILED".into(),
            job_id: String::new(), result_count: 0, processing_time_ms: 0, error: Some(e) }),
    }
}

#[tauri::command]
async fn download_csv(req: serde_json::Value, state: State<'_, AppState>) -> Result<String, String> {
    let jid = req["jobId"].as_str().ok_or("jobId required")?.to_string();
    let out = req["outputPath"].as_str().ok_or("outputPath required")?.to_string();
    let enc = req["encoding"].as_str().unwrap_or("utf-8-bom").to_string();
    let bytes = get_client(&state)?.get_results_csv(&jid, &enc).await?;
    fs::write(&out, &bytes).map_err(|e| format!("CSV保存エラー: {}", e))?;
    Ok(out)
}

// ============================================================
// Logs (SQLite-backed)
// ============================================================

#[tauri::command]
fn get_processing_logs(limit: Option<u32>, state: State<'_, AppState>) -> Result<Vec<ProcessingLogEntry>, String> {
    Ok(state.db.list_logs(limit.unwrap_or(100))?.into_iter().map(|r| ProcessingLogEntry {
        id: r.id, profile_id: r.profile_id, profile_name: r.profile_name,
        file_name: r.file_name, status: r.status, job_id: r.job_id,
        result_count: r.result_count, processing_time_ms: r.processing_time_ms,
        error: r.error, created_at: r.created_at,
    }).collect())
}

#[tauri::command]
fn move_file(source: String, destination: String) -> Result<(), String> {
    if !std::path::Path::new(&source).exists() {
        return Err("ソースファイルが存在しません".to_string());
    }
    let dest = PathBuf::from(&destination);
    let final_path = if dest.exists() {
        let s = dest.file_stem().unwrap_or_default().to_string_lossy();
        let e = dest.extension().unwrap_or_default().to_string_lossy();
        dest.parent().unwrap_or(&dest).join(format!("{}_{}.{}", s, chrono::Local::now().format("%Y%m%d_%H%M%S"), e))
    } else { dest };
    fs::rename(&source, &final_path)
        .or_else(|_| fs::copy(&source, &final_path).and_then(|_| fs::remove_file(&source)).map(|_| ()))
        .map_err(|e| format!("移動エラー: {}", e))
}

// ============================================================
// Log Maintenance
// ============================================================

#[tauri::command]
fn cleanup_old_logs(days: Option<u32>, state: State<'_, AppState>) -> Result<u32, String> {
    let retention_days = days.unwrap_or(90);
    state.db.delete_old_logs(retention_days)
}

#[tauri::command]
fn get_log_count(state: State<'_, AppState>) -> Result<u32, String> {
    state.db.count_logs()
}

// ============================================================
// AI Usage
// ============================================================

#[tauri::command]
async fn fetch_ai_usage(
    period: Option<String>,
    from: Option<String>,
    to: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let p = period.as_deref().unwrap_or("daily");
    let result = client.get_ai_usage(p, from.as_deref(), to.as_deref()).await?;
    serde_json::to_value(&result).map_err(|e| format!("Serialize error: {}", e))
}

// ============================================================
// Auto Update
// ============================================================

#[tauri::command]
async fn check_for_update(app: AppHandle) -> Result<serde_json::Value, String> {
    let updater = app.updater().map_err(|e| format!("Updater error: {}", e))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(serde_json::json!({
            "available": true,
            "version": update.version,
            "currentVersion": update.current_version,
        })),
        Ok(None) => Ok(serde_json::json!({ "available": false })),
        Err(e) => Err(format!("Update check error: {}", e)),
    }
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| format!("Updater error: {}", e))?;
    let update = updater.check().await.map_err(|e| format!("Check error: {}", e))?
        .ok_or("更新はありません")?;
    println!("[Updater] ダウンロード開始: v{}", update.version);
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| format!("Install error: {}", e))?;
    println!("[Updater] インストール完了。再起動します...");
    app.restart();
}

// ============================================================
// App Entry
// ============================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance: prevent duplicate launches
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, show the existing window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Database
            let app_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
            let db_path = app_dir.join("kamitoru-desktop.db");
            println!("[App] Database: {}", db_path.display());
            let db = Database::open(&db_path).expect("Failed to open database");

            // 起動時に90日以上前のログを自動削除
            match db.delete_old_logs(90) {
                Ok(deleted) if deleted > 0 => println!("[App] 起動時ログクリーンアップ: {}件削除", deleted),
                Ok(_) => {},
                Err(e) => println!("[App] ログクリーンアップ失敗（無視）: {}", e),
            }

            app.manage(AppState { db, api_client: Mutex::new(None), stop_flags: Mutex::new(HashMap::new()) });

            // System tray with right-click menu
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::TrayIconBuilder;

            let app_label = MenuItemBuilder::with_id("app_label", "カミトル デスクトップ")
                .enabled(false)
                .build(app)?;
            let show = MenuItemBuilder::with_id("show", "ウィンドウを表示").build(app)?;
            let start_all = MenuItemBuilder::with_id("start_all", "全プロファイル開始").build(app)?;
            let stop_all = MenuItemBuilder::with_id("stop_all", "全プロファイル停止").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "終了").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&app_label)
                .separator()
                .item(&show)
                .separator()
                .item(&start_all)
                .item(&stop_all)
                .separator()
                .item(&quit)
                .build()?;

            TrayIconBuilder::new()
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).expect("Failed to load icon"))
                .menu(&menu)
                .tooltip("カミトル デスクトップ")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "start_all" => {
                            if let Some(state) = app.try_state::<AppState>() {
                                if let Ok(profiles) = state.db.list_profiles() {
                                    for profile in profiles {
                                        if !profile.is_active {
                                            let _ = state.db.set_profile_active(&profile.id, true);
                                            if let Some(client) = state.api_client.lock().unwrap_or_else(|e| e.into_inner()).as_ref().cloned() {
                                                let mut flags = state.stop_flags.lock().unwrap_or_else(|e| e.into_inner());
                                                if let Some(old) = flags.remove(&profile.id) {
                                                    *old.lock().unwrap_or_else(|e| e.into_inner()) = true;
                                                }
                                                let flag = Arc::new(Mutex::new(false));
                                                flags.insert(profile.id.clone(), flag.clone());
                                                drop(flags);
                                                watch_engine::start_watcher(
                                                    app.clone(), profile.id, profile.name, profile.template_id,
                                                    profile.input_folder, profile.output_folder, profile.processed_folder,
                                                    profile.csv_encoding, profile.output_cycle,
                                                    profile.polling_interval_seconds, client, flag,
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                            println!("[Tray] 全プロファイル開始");
                        }
                        "stop_all" => {
                            if let Some(state) = app.try_state::<AppState>() {
                                let mut flags = state.stop_flags.lock().unwrap_or_else(|e| e.into_inner());
                                for (_, flag) in flags.drain() {
                                    *flag.lock().unwrap_or_else(|e| e.into_inner()) = true;
                                }
                                if let Ok(profiles) = state.db.list_profiles() {
                                    for p in profiles {
                                        let _ = state.db.set_profile_active(&p.id, false);
                                    }
                                }
                            }
                            println!("[Tray] 全プロファイル停止");
                        }
                        "quit" => {
                            println!("[App] Quit from tray menu");
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Double-click on tray icon shows the window
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Auto-update check (5秒後にバックグラウンドで実行)
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                println!("[Updater] 更新チェック開始...");
                match handle.updater() {
                    Ok(updater) => {
                        match updater.check().await {
                            Ok(Some(update)) => {
                                println!("[Updater] 新バージョン発見: {}", update.version);
                                let _ = handle.emit("update-available", serde_json::json!({
                                    "version": update.version,
                                    "currentVersion": update.current_version,
                                }));
                            }
                            Ok(None) => println!("[Updater] 最新バージョンです"),
                            Err(e) => println!("[Updater] チェック失敗（無視）: {}", e),
                        }
                    }
                    Err(e) => println!("[Updater] Updater未設定（無視）: {}", e),
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            test_connection, check_saved_session, logout, fetch_templates,
            get_profiles, create_profile, update_profile, delete_profile, toggle_profile_active,
            extract_file, batch_extract, download_csv,
            get_processing_logs, move_file,
            cleanup_old_logs, get_log_count,
            fetch_ai_usage,
            check_for_update, install_update,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Close button minimizes to tray instead of quitting
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
