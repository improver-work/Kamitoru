use crate::api_client::ApiClient;
use crate::db::LogInsert;
use base64::Engine;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri::{AppHandle, Emitter};

// ============================================================
// Error Classification
// ============================================================

#[derive(Debug, Clone)]
pub enum ErrorCategory {
    Network,    // 接続エラー、タイムアウト
    Auth,       // 認証エラー（401, 403）
    Api,        // APIエラー（400, 422, 500等）
    FileSystem, // ファイル読み込み/書き込みエラー
    Unknown,    // その他
}

pub fn classify_error(error: &str) -> ErrorCategory {
    let lower = error.to_lowercase();
    if lower.contains("connection error")
        || lower.contains("timeout")
        || lower.contains("dns")
        || lower.contains("connect")
        || lower.contains("network")
    {
        ErrorCategory::Network
    } else if lower.contains("401")
        || lower.contains("403")
        || lower.contains("unauthorized")
        || lower.contains("forbidden")
        || lower.contains("apiキー")
        || lower.contains("api key")
        || lower.contains("認証")
    {
        ErrorCategory::Auth
    } else if lower.contains("ファイル読み込み")
        || lower.contains("ファイルエラー")
        || lower.contains("フォルダ")
        || lower.contains("csv保存")
        || lower.contains("ファイル移動")
        || lower.contains("ファイルが使用中")
        || lower.contains("追記エラー")
        || lower.contains("permission denied")
    {
        ErrorCategory::FileSystem
    } else if lower.contains("http 4")
        || lower.contains("http 5")
        || lower.contains("parse error")
        || lower.contains("api")
    {
        ErrorCategory::Api
    } else {
        ErrorCategory::Unknown
    }
}

pub fn error_to_japanese(category: &ErrorCategory, detail: &str) -> String {
    match category {
        ErrorCategory::Network => format!("ネットワーク接続エラー: {}", detail),
        ErrorCategory::Auth => "認証エラー: APIキーを確認してください".to_string(),
        ErrorCategory::Api => format!("API処理エラー: {}", detail),
        ErrorCategory::FileSystem => format!("ファイルエラー: {}", detail),
        ErrorCategory::Unknown => format!("予期しないエラー: {}", detail),
    }
}

/// リトライ対象かどうかを判定する
fn is_retryable_error(error: &str) -> bool {
    let category = classify_error(error);
    match category {
        ErrorCategory::Network => true,
        ErrorCategory::Api => {
            // 5xx系のみリトライ対象
            let lower = error.to_lowercase();
            lower.contains("http 5") || lower.contains("500") || lower.contains("502")
                || lower.contains("503") || lower.contains("504")
        }
        _ => false,
    }
}

/// Windows通知を送信する
fn send_notification(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    match app.notification().builder().title(title).body(body).show() {
        Ok(_) => println!("[Notification] {}: {}", title, body),
        Err(e) => println!("[Notification] 送信失敗 (fallback log) {}: {} - error: {}", title, body, e),
    }
}

/// Event payload sent to the frontend
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchEvent {
    pub profile_id: String,
    pub event_type: String, // "file_detected", "processing", "completed", "error", "network_disconnected", "network_reconnected"
    pub file_name: String,
    pub message: String,
    pub job_id: Option<String>,
    pub result_count: Option<u32>,
    pub processing_time_ms: Option<u64>,
}

/// Shared state for tracking processed files per profile
pub type ProcessedFiles = Arc<Mutex<HashSet<String>>>;

/// Start watching a profile's input folder.
/// Spawns a background tokio task that polls the folder at the configured interval.
/// Returns a handle to stop the watcher.
pub fn start_watcher(
    app: AppHandle,
    profile_id: String,
    profile_name: String,
    template_id: String,
    input_folder: String,
    output_folder: String,
    processed_folder: String,
    csv_encoding: String,
    output_cycle: String,
    polling_interval_seconds: u32,
    api_client: ApiClient,
    stop_flag: Arc<Mutex<bool>>,
) {
    let processed_files: ProcessedFiles = Arc::new(Mutex::new(HashSet::new()));

    tauri::async_runtime::spawn(async move {
        println!(
            "[Watch] Started watcher for profile {} on folder: {}",
            profile_id, input_folder
        );

        let mut consecutive_network_errors: u32 = 0;
        const NETWORK_DISCONNECT_THRESHOLD: u32 = 3;

        loop {
            // Check stop flag
            if *stop_flag.lock().unwrap() {
                println!("[Watch] Stopping watcher for profile {}", profile_id);
                break;
            }

            // Scan for new PDF files
            match scan_for_pdfs(&input_folder, &processed_files) {
                Ok(new_files) => {
                    for file_path in new_files {
                        let file_name = file_path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();

                        println!("[Watch] Detected new PDF: {}", file_name);

                        // Emit file_detected event
                        let _ = app.emit(
                            "watch-event",
                            WatchEvent {
                                profile_id: profile_id.clone(),
                                event_type: "file_detected".into(),
                                file_name: file_name.clone(),
                                message: format!("新しいPDFを検出: {}", file_name),
                                job_id: None,
                                result_count: None,
                                processing_time_ms: None,
                            },
                        );

                        // Wait for file write completion (check size stability)
                        if !wait_for_write_complete(&file_path).await {
                            println!("[Watch] File still being written, skipping: {}", file_name);
                            continue;
                        }

                        // Emit processing event
                        let _ = app.emit(
                            "watch-event",
                            WatchEvent {
                                profile_id: profile_id.clone(),
                                event_type: "processing".into(),
                                file_name: file_name.clone(),
                                message: format!("処理中: {}", file_name),
                                job_id: None,
                                result_count: None,
                                processing_time_ms: None,
                            },
                        );

                        // Process the file (with retry logic)
                        let result = process_pdf_with_retry(
                            &app,
                            &profile_id,
                            &file_name,
                            &file_path,
                            &template_id,
                            &profile_name,
                            &output_folder,
                            &processed_folder,
                            &csv_encoding,
                            &output_cycle,
                            &api_client,
                        )
                        .await;

                        match result {
                            Ok((job_id, result_count, time_ms)) => {
                                consecutive_network_errors = 0;
                                println!("[Watch] Completed: {} -> {} results in {}ms", file_name, result_count, time_ms);
                                processed_files.lock().unwrap().insert(file_path.to_string_lossy().to_string());

                                // Save to SQLite
                                if let Some(state) = app.try_state::<crate::AppState>() {
                                    let _ = state.db.insert_log(&LogInsert {
                                        profile_id: profile_id.clone(), profile_name: profile_name.clone(),
                                        file_name: file_name.clone(), status: "SUCCESS".into(),
                                        job_id: job_id.clone(), result_count, processing_time_ms: time_ms,
                                        error: None, created_at: chrono::Local::now().to_rfc3339(),
                                    });
                                }

                                let _ = app.emit("watch-event", WatchEvent {
                                    profile_id: profile_id.clone(), event_type: "completed".into(),
                                    file_name: file_name.clone(),
                                    message: format!("完了: {} ({} fields, {:.1}s)", file_name, result_count, time_ms as f64 / 1000.0),
                                    job_id: Some(job_id), result_count: Some(result_count), processing_time_ms: Some(time_ms),
                                });

                                // Windows通知: 処理完了
                                send_notification(
                                    &app,
                                    "処理完了",
                                    &format!("{}の処理が完了しました（{}項目）", file_name, result_count),
                                );
                            }
                            Err(e) => {
                                let category = classify_error(&e);
                                let japanese_msg = error_to_japanese(&category, &e);
                                println!("[Watch] Error processing {}: {}", file_name, japanese_msg);
                                processed_files.lock().unwrap().insert(file_path.to_string_lossy().to_string());

                                // ネットワークエラーの場合のみカウンターをインクリメント
                                if matches!(category, ErrorCategory::Network) {
                                    consecutive_network_errors += 1;
                                    println!(
                                        "[Watch] ネットワークエラー連続回数: {}/{}",
                                        consecutive_network_errors, NETWORK_DISCONNECT_THRESHOLD
                                    );
                                }

                                // Save error to SQLite
                                if let Some(state) = app.try_state::<crate::AppState>() {
                                    let _ = state.db.insert_log(&LogInsert {
                                        profile_id: profile_id.clone(), profile_name: profile_name.clone(),
                                        file_name: file_name.clone(), status: "FAILED".into(),
                                        job_id: String::new(), result_count: 0, processing_time_ms: 0,
                                        error: Some(japanese_msg.clone()), created_at: chrono::Local::now().to_rfc3339(),
                                    });
                                }

                                // Emit error event
                                let _ = app.emit(
                                    "watch-event",
                                    WatchEvent {
                                        profile_id: profile_id.clone(),
                                        event_type: "error".into(),
                                        file_name: file_name.clone(),
                                        message: format!("エラー: {} - {}", file_name, japanese_msg),
                                        job_id: None,
                                        result_count: None,
                                        processing_time_ms: None,
                                    },
                                );

                                // Windows通知: 処理エラー
                                send_notification(
                                    &app,
                                    "処理エラー",
                                    &format!("{}: {}", file_name, japanese_msg),
                                );
                            }
                        }
                    }
                }
                Err(e) => {
                    println!("[Watch] Scan error for profile {}: {}", profile_id, e);
                }
            }

            // ネットワーク断検知: 連続エラーが閾値に達した場合、再接続ループに入る
            if consecutive_network_errors >= NETWORK_DISCONNECT_THRESHOLD {
                println!(
                    "[Watch] ネットワーク断を検知 (連続{}回のネットワークエラー) - 再接続を試みます",
                    consecutive_network_errors
                );

                // ネットワーク断イベントを送信
                let _ = app.emit(
                    "watch-event",
                    WatchEvent {
                        profile_id: profile_id.clone(),
                        event_type: "network_disconnected".into(),
                        file_name: String::new(),
                        message: "ネットワーク接続が切断されました。再接続を試みます...".into(),
                        job_id: None,
                        result_count: None,
                        processing_time_ms: None,
                    },
                );

                // Windows通知: 接続断
                send_notification(
                    &app,
                    "接続断",
                    "ネットワーク接続が切断されました。再接続を試みます...",
                );

                // 再接続ループ
                loop {
                    // 停止チェック
                    if *stop_flag.lock().unwrap() {
                        println!("[Watch] 再接続待機中に停止要求を検知");
                        break;
                    }

                    // API疎通チェック（templates取得）
                    match api_client.get_templates().await {
                        Ok(_) => {
                            println!("[Watch] ネットワーク接続が復旧しました");

                            // 再接続成功イベントを送信
                            let _ = app.emit(
                                "watch-event",
                                WatchEvent {
                                    profile_id: profile_id.clone(),
                                    event_type: "network_reconnected".into(),
                                    file_name: String::new(),
                                    message: "ネットワーク接続が復旧しました".into(),
                                    job_id: None,
                                    result_count: None,
                                    processing_time_ms: None,
                                },
                            );

                            // Windows通知: 接続復旧
                            send_notification(
                                &app,
                                "接続復旧",
                                "ネットワーク接続が復旧しました",
                            );

                            consecutive_network_errors = 0;
                            break; // 通常のポーリングループに戻る
                        }
                        Err(_) => {
                            println!("[Watch] 再接続待機中... (30秒後に再試行)");
                            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                        }
                    }
                }
            }

            // Wait for next poll
            tokio::time::sleep(std::time::Duration::from_secs(polling_interval_seconds as u64)).await;
        }

        println!("[Watch] Watcher stopped for profile {}", profile_id);
    });
}

/// Scan the input folder for PDF files that haven't been processed yet.
fn scan_for_pdfs(folder: &str, processed: &ProcessedFiles) -> Result<Vec<PathBuf>, String> {
    let path = Path::new(folder);
    if !path.exists() {
        return Err(format!("入力フォルダが存在しません: {}", folder));
    }

    let processed_set = processed.lock().unwrap();
    let mut new_files = Vec::new();

    let entries =
        std::fs::read_dir(path).map_err(|e| format!("フォルダ読み込みエラー: {}", e))?;

    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_file() {
            if let Some(ext) = entry_path.extension() {
                if ext.to_ascii_lowercase() == "pdf" {
                    let key = entry_path.to_string_lossy().to_string();
                    if !processed_set.contains(&key) {
                        new_files.push(entry_path);
                    }
                }
            }
        }
    }

    Ok(new_files)
}

/// Wait for a file to finish being written (check size stability).
async fn wait_for_write_complete(path: &Path) -> bool {
    let mut last_size: u64 = 0;
    let mut stable_count = 0;

    for _ in 0..10 {
        // Max 5 seconds wait (10 * 500ms)
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        match std::fs::metadata(path) {
            Ok(meta) => {
                let size = meta.len();
                if size > 0 && size == last_size {
                    stable_count += 1;
                    if stable_count >= 2 {
                        return true; // Size stable for 1 second
                    }
                } else {
                    stable_count = 0;
                }
                last_size = size;
            }
            Err(_) => return false, // File disappeared
        }
    }

    last_size > 0 // File exists with non-zero size
}

/// Build CSV content from extraction results directly (no separate API call needed).
fn build_csv_from_results(
    results: &[crate::api_client::ExtractionResult],
    file_name: &str,
) -> String {
    if results.is_empty() {
        return String::from("FileName,Message\n") + file_name + ",No results extracted\n";
    }

    // Collect unique column names in order of appearance
    let mut columns: Vec<String> = Vec::new();
    for r in results {
        if !columns.contains(&r.column_name) {
            columns.push(r.column_name.clone());
        }
    }

    // Build CSV header
    let mut csv = String::from("FileName");
    for col in &columns {
        csv.push(',');
        csv.push_str(&escape_csv(col));
    }
    csv.push('\n');

    // Group results by row (for table rows) or single row
    let mut rows: std::collections::BTreeMap<i32, std::collections::HashMap<String, String>> =
        std::collections::BTreeMap::new();

    for r in results {
        let row_idx = 0; // Simple: all results in row 0
        let row = rows.entry(row_idx).or_default();
        let value = r.raw_value.clone();
        row.insert(r.column_name.clone(), value);
    }

    // Write data rows
    for (_idx, row_data) in &rows {
        csv.push_str(&escape_csv(file_name));
        for col in &columns {
            csv.push(',');
            let val = row_data.get(col).map(|s| s.as_str()).unwrap_or("");
            csv.push_str(&escape_csv(val));
        }
        csv.push('\n');
    }

    csv
}

fn escape_csv(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Encode CSV string to bytes with the specified encoding.
/// - "utf-8-bom": UTF-8 with BOM (Excel on Windows/Japan compatible)
/// - "utf-8": UTF-8 without BOM
/// - "shift_jis": Shift-JIS encoding
fn encode_csv_bytes(csv: &str, encoding: &str) -> Vec<u8> {
    match encoding {
        "utf-8-bom" => {
            // UTF-8 BOM (0xEF, 0xBB, 0xBF) + UTF-8 content
            let mut bytes = vec![0xEF, 0xBB, 0xBF];
            bytes.extend_from_slice(csv.as_bytes());
            bytes
        }
        "shift_jis" => {
            // Convert UTF-8 to Shift-JIS using encoding_rs
            let (encoded, _, _) = encoding_rs::SHIFT_JIS.encode(csv);
            encoded.to_vec()
        }
        _ => {
            // Plain UTF-8
            csv.as_bytes().to_vec()
        }
    }
}

/// Determine the output CSV filename based on the output cycle.
fn get_csv_filename(profile_name: &str, file_name: &str, output_cycle: &str) -> String {
    let now = chrono::Local::now();
    match output_cycle {
        "hourly" => format!("{}_{}.csv", profile_name, now.format("%Y%m%d_%H")),
        "daily" => format!("{}_{}.csv", profile_name, now.format("%Y%m%d")),
        "weekly" => format!("{}_{}.csv", profile_name, now.format("%G-W%V")),
        _ => {
            // "none" = individual files (current behavior)
            let stem = Path::new(file_name)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            format!("{}_{}.csv", stem, now.format("%Y%m%d_%H%M%S"))
        }
    }
}

/// Write CSV data to file. If the file already exists and output_cycle is not "none",
/// append data rows only (skip header). Otherwise create new file with header.
fn write_csv_to_file(
    csv_path: &Path,
    csv_content: &str,
    csv_encoding: &str,
    is_accumulate: bool,
) -> Result<(), String> {
    use std::io::Write;

    if is_accumulate && csv_path.exists() {
        // Append mode: skip the header line, write only data rows
        let lines: Vec<&str> = csv_content.lines().collect();
        if lines.len() <= 1 {
            return Ok(()); // Only header, no data to append
        }
        let data_only = lines[1..].join("\n") + "\n";
        let data_bytes = match csv_encoding {
            "shift_jis" => {
                let (encoded, _, _) = encoding_rs::SHIFT_JIS.encode(&data_only);
                encoded.to_vec()
            }
            _ => data_only.into_bytes(), // UTF-8 (no BOM on append)
        };

        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(csv_path)
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    format!("ファイルが使用中です（Excelで開いていませんか？）: {}", csv_path.display())
                } else {
                    format!("ファイルを開けません: {}", e)
                }
            })?;
        file.write_all(&data_bytes).map_err(|e| format!("追記エラー: {}", e))?;
        println!("[Watch] CSV appended to: {}", csv_path.display());
    } else {
        // New file: write header + data with encoding (including BOM if needed)
        let csv_bytes = encode_csv_bytes(csv_content, csv_encoding);
        std::fs::write(csv_path, &csv_bytes).map_err(|e| format!("CSV保存エラー: {}", e))?;
        println!("[Watch] CSV created: {}", csv_path.display());
    }
    Ok(())
}

/// API呼び出しを指数バックオフでリトライする（最大3回、1秒→2秒→4秒）
/// Network errorや5xx errorの場合のみリトライ。4xx（認証エラー等）はリトライしない。
async fn process_pdf_with_retry(
    app: &AppHandle,
    profile_id: &str,
    file_name: &str,
    file_path: &Path,
    template_id: &str,
    profile_name: &str,
    output_folder: &str,
    processed_folder: &str,
    csv_encoding: &str,
    output_cycle: &str,
    api_client: &ApiClient,
) -> Result<(String, u32, u64), String> {
    const MAX_RETRIES: u32 = 3;
    let retry_delays_ms: [u64; 3] = [1000, 2000, 4000];

    let mut last_error = String::new();

    for attempt in 0..MAX_RETRIES {
        match process_pdf(
            file_path,
            template_id,
            profile_name,
            output_folder,
            processed_folder,
            csv_encoding,
            output_cycle,
            api_client,
        )
        .await
        {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_error = e.clone();

                // リトライ対象でなければ即座にエラーを返す
                if !is_retryable_error(&e) {
                    println!("[Watch] リトライ対象外のエラー: {}", e);
                    return Err(e);
                }

                // 最後の試行ならリトライせずエラーを返す
                if attempt + 1 >= MAX_RETRIES {
                    println!(
                        "[Watch] 全リトライ失敗 ({}回): {} - {}",
                        MAX_RETRIES, file_name, e
                    );
                    return Err(e);
                }

                let delay_ms = retry_delays_ms[attempt as usize];
                println!(
                    "[Watch] リトライ中: {} (試行 {}/{}) - {}ms後に再試行",
                    file_name,
                    attempt + 2,
                    MAX_RETRIES,
                    delay_ms
                );

                // リトライ中イベントを通知
                let _ = app.emit(
                    "watch-event",
                    WatchEvent {
                        profile_id: profile_id.to_string(),
                        event_type: "processing".into(),
                        file_name: file_name.to_string(),
                        message: format!(
                            "リトライ中: {} (試行 {}/{})",
                            file_name,
                            attempt + 2,
                            MAX_RETRIES
                        ),
                        job_id: None,
                        result_count: None,
                        processing_time_ms: None,
                    },
                );

                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
        }
    }

    Err(last_error)
}

/// Process a single PDF file: extract via API, save CSV, move PDF.
async fn process_pdf(
    file_path: &Path,
    template_id: &str,
    profile_name: &str,
    output_folder: &str,
    processed_folder: &str,
    csv_encoding: &str,
    output_cycle: &str,
    api_client: &ApiClient,
) -> Result<(String, u32, u64), String> {
    let file_name = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // 1. Read PDF and convert to base64
    let file_bytes =
        std::fs::read(file_path).map_err(|e| format!("ファイル読み込みエラー: {}", e))?;
    let pdf_base64 = base64::engine::general_purpose::STANDARD.encode(&file_bytes);

    // 2. Call extraction API
    println!("[Watch] Calling extract API for {}...", file_name);
    let resp = api_client
        .extract(template_id, &pdf_base64, &file_name)
        .await?;

    let job_id = resp.job_id.clone();
    let result_count = resp.summary.total_fields;
    let processing_time_ms = resp.summary.processing_time_ms;

    println!(
        "[Watch] Extract response: status={}, fields={}, time={}ms",
        resp.status, result_count, processing_time_ms
    );

    // 3. Build CSV and save (with accumulation support)
    let csv_content = build_csv_from_results(&resp.results, &file_name);
    let csv_filename = get_csv_filename(profile_name, &file_name, output_cycle);
    let csv_path = Path::new(output_folder).join(&csv_filename);

    std::fs::create_dir_all(output_folder)
        .map_err(|e| format!("出力フォルダ作成エラー: {}", e))?;

    let is_accumulate = output_cycle != "none";
    write_csv_to_file(&csv_path, &csv_content, csv_encoding, is_accumulate)?;

    // 5. Move PDF to processed folder
    std::fs::create_dir_all(processed_folder)
        .map_err(|e| format!("処理済みフォルダ作成エラー: {}", e))?;

    let dest = Path::new(processed_folder).join(&file_name);
    let final_dest = if dest.exists() {
        // Handle name collision
        let dest_stem = dest
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let dest_ext = dest.extension().unwrap_or_default().to_string_lossy();
        Path::new(processed_folder).join(format!("{}_{}.{}", dest_stem, chrono::Local::now().format("%Y%m%d_%H%M%S"), dest_ext))
    } else {
        dest
    };

    std::fs::rename(file_path, &final_dest)
        .or_else(|_| {
            std::fs::copy(file_path, &final_dest)
                .and_then(|_| std::fs::remove_file(file_path))
                .map(|_| ())
        })
        .map_err(|e| format!("ファイル移動エラー: {}", e))?;

    println!("[Watch] PDF moved to: {}", final_dest.display());

    Ok((job_id, result_count, processing_time_ms))
}
