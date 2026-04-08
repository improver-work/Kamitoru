use rusqlite::{Connection, params};
use std::path::Path;
use std::sync::Mutex;

/// Database wrapper for SQLite persistence.
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Open or create the SQLite database at the given path.
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let db = Self { conn: Mutex::new(conn) };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS connection (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                api_url TEXT NOT NULL DEFAULT '',
                supabase_url TEXT DEFAULT '',
                supabase_anon_key TEXT DEFAULT '',
                user_email TEXT DEFAULT '',
                user_id TEXT DEFAULT '',
                tenant_id TEXT DEFAULT '',
                tenant_name TEXT DEFAULT '',
                api_key TEXT DEFAULT '',
                connected_at TEXT
            );

            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                template_id TEXT NOT NULL,
                template_name TEXT NOT NULL,
                input_folder TEXT NOT NULL,
                output_folder TEXT NOT NULL,
                processed_folder TEXT NOT NULL,
                csv_encoding TEXT DEFAULT 'utf-8-bom',
                output_cycle TEXT DEFAULT 'none',
                polling_interval_seconds INTEGER DEFAULT 5,
                is_active INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            -- Migration: add output_cycle if not exists (for existing DBs)
            -- SQLite doesn't support IF NOT EXISTS for ADD COLUMN, so we ignore errors


            CREATE TABLE IF NOT EXISTS processing_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id TEXT,
                profile_name TEXT,
                file_name TEXT NOT NULL,
                status TEXT NOT NULL,
                job_id TEXT DEFAULT '',
                result_count INTEGER DEFAULT 0,
                processing_time_ms INTEGER DEFAULT 0,
                error TEXT,
                created_at TEXT NOT NULL
            );

            -- Ensure connection row exists
            INSERT OR IGNORE INTO connection (id) VALUES (1);
        ").map_err(|e| format!("Failed to initialize tables: {}", e))?;

        // Migration: add output_cycle column for existing databases
        let _ = conn.execute("ALTER TABLE profiles ADD COLUMN output_cycle TEXT DEFAULT 'none'", []);

        println!("[DB] Tables initialized");
        Ok(())
    }

    // ===== Connection Settings =====

    pub fn save_connection(&self, api_url: &str, api_key: &str, user_email: &str,
                           tenant_id: &str, tenant_name: &str, supabase_url: &str, supabase_anon_key: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE connection SET api_url=?1, api_key=?2, user_email=?3, tenant_id=?4, tenant_name=?5, supabase_url=?6, supabase_anon_key=?7, connected_at=datetime('now') WHERE id=1",
            params![api_url, api_key, user_email, tenant_id, tenant_name, supabase_url, supabase_anon_key],
        ).map_err(|e| format!("Failed to save connection: {}", e))?;
        Ok(())
    }

    pub fn load_connection(&self) -> Result<ConnectionRow, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT api_url, api_key, user_email, tenant_id, tenant_name, supabase_url, supabase_anon_key, connected_at FROM connection WHERE id=1",
            [],
            |row| Ok(ConnectionRow {
                api_url: row.get(0).unwrap_or_default(),
                api_key: row.get(1).unwrap_or_default(),
                user_email: row.get(2).unwrap_or_default(),
                tenant_id: row.get(3).unwrap_or_default(),
                tenant_name: row.get(4).unwrap_or_default(),
                supabase_url: row.get(5).unwrap_or_default(),
                supabase_anon_key: row.get(6).unwrap_or_default(),
                connected_at: row.get(7).unwrap_or_default(),
            }),
        ).map_err(|e| format!("Failed to load connection: {}", e))
    }

    pub fn clear_connection(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE connection SET api_url='', api_key='', user_email='', tenant_id='', tenant_name='', connected_at=NULL WHERE id=1",
            [],
        ).map_err(|e| format!("Failed to clear connection: {}", e))?;
        Ok(())
    }

    // ===== Profiles =====

    pub fn list_profiles(&self) -> Result<Vec<ProfileRow>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, template_id, template_name, input_folder, output_folder, processed_folder, csv_encoding, output_cycle, polling_interval_seconds, is_active, created_at, updated_at FROM profiles ORDER BY created_at"
        ).map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt.query_map([], |row| Ok(ProfileRow {
            id: row.get(0)?,
            name: row.get(1)?,
            template_id: row.get(2)?,
            template_name: row.get(3)?,
            input_folder: row.get(4)?,
            output_folder: row.get(5)?,
            processed_folder: row.get(6)?,
            csv_encoding: row.get(7)?,
            output_cycle: row.get(8)?,
            polling_interval_seconds: row.get(9)?,
            is_active: row.get::<_, i32>(10)? != 0,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
        })).map_err(|e| format!("Query error: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Row error: {}", e))
    }

    pub fn insert_profile(&self, p: &ProfileRow) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO profiles (id, name, template_id, template_name, input_folder, output_folder, processed_folder, csv_encoding, output_cycle, polling_interval_seconds, is_active, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![p.id, p.name, p.template_id, p.template_name, p.input_folder, p.output_folder, p.processed_folder, p.csv_encoding, p.output_cycle, p.polling_interval_seconds, p.is_active as i32, p.created_at, p.updated_at],
        ).map_err(|e| format!("Insert error: {}", e))?;
        Ok(())
    }

    pub fn update_profile(&self, p: &ProfileRow) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE profiles SET name=?2, template_id=?3, template_name=?4, input_folder=?5, output_folder=?6, processed_folder=?7, csv_encoding=?8, output_cycle=?9, polling_interval_seconds=?10, updated_at=?11 WHERE id=?1",
            params![p.id, p.name, p.template_id, p.template_name, p.input_folder, p.output_folder, p.processed_folder, p.csv_encoding, p.output_cycle, p.polling_interval_seconds, p.updated_at],
        ).map_err(|e| format!("Update error: {}", e))?;
        Ok(())
    }

    pub fn delete_profile(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM profiles WHERE id=?1", params![id])
            .map_err(|e| format!("Delete error: {}", e))?;
        Ok(())
    }

    pub fn set_profile_active(&self, id: &str, active: bool) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE profiles SET is_active=?2, updated_at=datetime('now') WHERE id=?1",
            params![id, active as i32],
        ).map_err(|e| format!("Update error: {}", e))?;
        Ok(())
    }

    // ===== Processing Logs =====

    pub fn insert_log(&self, log: &LogInsert) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO processing_logs (profile_id, profile_name, file_name, status, job_id, result_count, processing_time_ms, error, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![log.profile_id, log.profile_name, log.file_name, log.status, log.job_id, log.result_count, log.processing_time_ms, log.error, log.created_at],
        ).map_err(|e| format!("Insert log error: {}", e))?;
        Ok(())
    }

    pub fn list_logs(&self, limit: u32) -> Result<Vec<LogRow>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, profile_id, profile_name, file_name, status, job_id, result_count, processing_time_ms, error, created_at FROM processing_logs ORDER BY id DESC LIMIT ?1"
        ).map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt.query_map(params![limit], |row| Ok(LogRow {
            id: row.get(0)?,
            profile_id: row.get(1)?,
            profile_name: row.get(2)?,
            file_name: row.get(3)?,
            status: row.get(4)?,
            job_id: row.get(5)?,
            result_count: row.get(6)?,
            processing_time_ms: row.get(7)?,
            error: row.get(8)?,
            created_at: row.get(9)?,
        })).map_err(|e| format!("Query error: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Row error: {}", e))
    }

    /// 指定日数より古い処理ログを削除する
    pub fn delete_old_logs(&self, retention_days: u32) -> Result<u32, String> {
        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute(
            "DELETE FROM processing_logs WHERE created_at < datetime('now', ?1)",
            params![format!("-{} days", retention_days)],
        ).map_err(|e| format!("Delete old logs error: {}", e))?;
        if deleted > 0 {
            println!("[DB] {}日以上前のログを{}件削除しました", retention_days, deleted);
        }
        Ok(deleted as u32)
    }

    /// 処理ログの総件数を取得
    pub fn count_logs(&self) -> Result<u32, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM processing_logs",
            [],
            |row| row.get::<_, u32>(0),
        ).map_err(|e| format!("Count logs error: {}", e))
    }
}

// ===== Row types =====

#[derive(Debug, Clone, Default)]
pub struct ConnectionRow {
    pub api_url: String,
    pub api_key: String,
    pub user_email: String,
    pub tenant_id: String,
    pub tenant_name: String,
    pub supabase_url: String,
    pub supabase_anon_key: String,
    pub connected_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProfileRow {
    pub id: String,
    pub name: String,
    pub template_id: String,
    pub template_name: String,
    pub input_folder: String,
    pub output_folder: String,
    pub processed_folder: String,
    pub csv_encoding: String,
    pub output_cycle: String,
    pub polling_interval_seconds: u32,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct LogInsert {
    pub profile_id: String,
    pub profile_name: String,
    pub file_name: String,
    pub status: String,
    pub job_id: String,
    pub result_count: u32,
    pub processing_time_ms: u64,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct LogRow {
    pub id: i64,
    pub profile_id: String,
    pub profile_name: String,
    pub file_name: String,
    pub status: String,
    pub job_id: String,
    pub result_count: u32,
    pub processing_time_ms: u64,
    pub error: Option<String>,
    pub created_at: String,
}
