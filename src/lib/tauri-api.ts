/**
 * Tauri IPC bindings for the desktop client.
 * Supports multiple watch profiles and SQLite persistence.
 */

// --- Types ---

export interface Template {
  id: string;
  name: string;
  description: string;
  extractionType: string;
  fieldCount: number;
  hasTableRegion: boolean;
}

export interface ConnectionConfig {
  apiUrl: string;
  apiKey: string;
}

export interface ConnectionTestResult {
  success: boolean;
  templates: Template[];
  error: string | null;
}

export interface WatchProfile {
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  inputFolder: string;
  outputFolder: string;
  processedFolder: string;
  csvEncoding: "utf-8-bom" | "utf-8" | "shift_jis";
  outputCycle: "none" | "hourly" | "daily" | "weekly";
  pollingIntervalSeconds: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ProfileFormData = Omit<WatchProfile, "id" | "createdAt" | "updatedAt" | "isActive">;

export interface ExtractFileResult {
  fileName: string;
  status: string;
  jobId: string;
  resultCount: number;
  processingTimeMs: number;
  error: string | null;
}

export interface ProcessingLog {
  id: number;
  profileId: string;
  profileName: string;
  fileName: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  jobId: string;
  resultCount: number;
  processingTimeMs: number;
  error: string | null;
  createdAt: string;
}

export interface ProfileStats {
  profileId: string;
  totalProcessed: number;
  totalErrors: number;
  lastProcessedAt: string | null;
}

// --- Tauri IPC ---

// Tauri v2 detection: __TAURI_INTERNALS__ is always present in Tauri WebView
// regardless of withGlobalTauri setting in tauri.conf.json
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(command, args);
  }
  throw new Error(`Tauri not available: ${command}`);
}

// --- Mock data for browser dev ---

const MOCK_TEMPLATES: Template[] = [
  { id: "tmpl-1", name: "請求書テンプレート", description: "請求書からデータを抽出", extractionType: "FIELD", fieldCount: 8, hasTableRegion: false },
  { id: "tmpl-2", name: "納品書テンプレート", description: "納品書の明細を抽出", extractionType: "BOTH", fieldCount: 5, hasTableRegion: true },
  { id: "tmpl-3", name: "注文書テンプレート", description: "注文書の品目を抽出", extractionType: "TABLE", fieldCount: 3, hasTableRegion: true },
];

const MOCK_PROFILES: WatchProfile[] = [
  {
    id: "prof-1", name: "請求書自動処理", templateId: "tmpl-1", templateName: "請求書テンプレート",
    inputFolder: "C:\\Scan\\Invoices", outputFolder: "C:\\Output\\Invoices", processedFolder: "C:\\Done\\Invoices",
    csvEncoding: "utf-8-bom", outputCycle: "none", pollingIntervalSeconds: 5, isActive: true,
    createdAt: "2026-04-07T10:00:00", updatedAt: "2026-04-07T10:00:00",
  },
  {
    id: "prof-2", name: "納品書自動処理", templateId: "tmpl-2", templateName: "納品書テンプレート",
    inputFolder: "C:\\Scan\\Delivery", outputFolder: "C:\\Output\\Delivery", processedFolder: "C:\\Done\\Delivery",
    csvEncoding: "shift_jis", outputCycle: "daily", pollingIntervalSeconds: 10, isActive: false,
    createdAt: "2026-04-07T11:00:00", updatedAt: "2026-04-07T11:00:00",
  },
];

const MOCK_LOGS: ProcessingLog[] = [
  { id: 1, profileId: "prof-1", profileName: "請求書自動処理", fileName: "invoice_2026-04-01.pdf", status: "SUCCESS", jobId: "job-001", resultCount: 8, processingTimeMs: 3200, error: null, createdAt: "2026-04-07T10:30:00" },
  { id: 2, profileId: "prof-1", profileName: "請求書自動処理", fileName: "invoice_2026-04-02.pdf", status: "SUCCESS", jobId: "job-002", resultCount: 8, processingTimeMs: 2800, error: null, createdAt: "2026-04-07T10:31:00" },
  { id: 3, profileId: "prof-2", profileName: "納品書自動処理", fileName: "delivery_march.pdf", status: "PARTIAL", jobId: "job-003", resultCount: 5, processingTimeMs: 4100, error: null, createdAt: "2026-04-07T10:32:00" },
  { id: 4, profileId: "prof-1", profileName: "請求書自動処理", fileName: "broken_scan.pdf", status: "FAILED", jobId: "", resultCount: 0, processingTimeMs: 1500, error: "OCR extraction failed", createdAt: "2026-04-07T10:33:00" },
];

// --- Session / Auth ---

export interface SavedSession {
  connected: boolean;
  apiUrl: string;
  hasApiKey: boolean;
}

export async function checkSavedSession(): Promise<SavedSession> {
  if (!isTauri) return { connected: false, apiUrl: "", hasApiKey: false };
  return invoke<SavedSession>("check_saved_session");
}

export async function logout(): Promise<void> {
  if (!isTauri) return;
  return invoke<void>("logout");
}

export async function installUpdate(): Promise<void> {
  return invoke<void>("install_update");
}

// --- Connection ---

export async function testConnection(config: ConnectionConfig): Promise<ConnectionTestResult> {
  if (!isTauri) {
    await new Promise((r) => setTimeout(r, 800));
    return { success: true, templates: MOCK_TEMPLATES, error: null };
  }
  return invoke<ConnectionTestResult>("test_connection", { config });
}

export async function fetchTemplates(): Promise<Template[]> {
  if (!isTauri) return MOCK_TEMPLATES;
  return invoke<Template[]>("fetch_templates");
}

// --- Profiles ---

export async function getProfiles(): Promise<WatchProfile[]> {
  if (!isTauri) return MOCK_PROFILES;
  return invoke<WatchProfile[]>("get_profiles");
}

export async function createProfile(data: ProfileFormData): Promise<WatchProfile> {
  if (!isTauri) {
    const profile: WatchProfile = {
      ...data, id: `prof-${Date.now()}`, isActive: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    MOCK_PROFILES.push(profile);
    return profile;
  }
  return invoke<WatchProfile>("create_profile", { data });
}

export async function updateProfile(id: string, data: Partial<ProfileFormData>): Promise<WatchProfile> {
  if (!isTauri) {
    const idx = MOCK_PROFILES.findIndex((p) => p.id === id);
    if (idx >= 0) Object.assign(MOCK_PROFILES[idx], data, { updatedAt: new Date().toISOString() });
    return MOCK_PROFILES[idx];
  }
  return invoke<WatchProfile>("update_profile", { id, data });
}

export async function deleteProfile(id: string): Promise<void> {
  if (!isTauri) {
    const idx = MOCK_PROFILES.findIndex((p) => p.id === id);
    if (idx >= 0) MOCK_PROFILES.splice(idx, 1);
    return;
  }
  return invoke<void>("delete_profile", { id });
}

export async function toggleProfileActive(id: string, active: boolean): Promise<void> {
  if (!isTauri) {
    const p = MOCK_PROFILES.find((p) => p.id === id);
    if (p) p.isActive = active;
    return;
  }
  return invoke<void>("toggle_profile_active", { id, active });
}

// --- Extraction ---

export async function extractFile(templateId: string, filePath: string): Promise<ExtractFileResult> {
  return invoke<ExtractFileResult>("extract_file", { req: { templateId, filePath } });
}

export async function batchExtract(templateId: string, filePaths: string[]): Promise<ExtractFileResult> {
  return invoke<ExtractFileResult>("batch_extract", { req: { templateId, filePaths } });
}

export async function downloadCsv(jobId: string, outputPath: string, encoding: string): Promise<string> {
  return invoke<string>("download_csv", { req: { jobId, outputPath, encoding } });
}

// --- Logs ---

export async function getProcessingLogs(limit?: number): Promise<ProcessingLog[]> {
  if (!isTauri) return MOCK_LOGS.slice(0, limit ?? 50);
  return invoke<ProcessingLog[]>("get_processing_logs", { limit: limit ?? 50 });
}

// --- File operations ---

export async function moveFile(source: string, destination: string): Promise<void> {
  return invoke<void>("move_file", { source, destination });
}

// --- AI Usage ---

export interface AiUsageEntry {
  date: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
  requestCount: number;
  byModel: Record<string, { tokens: number; cost: number; requests: number }>;
}

export interface AiUsageTotals {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
  requestCount: number;
}

export interface AiUsageResponse {
  period: string;
  data: AiUsageEntry[];
  totals: AiUsageTotals;
}

export async function getAiUsage(
  period?: string,
  from?: string,
  to?: string,
): Promise<AiUsageResponse> {
  if (!isTauri) {
    // ブラウザ開発用モック
    return {
      period: period ?? "daily",
      data: [
        {
          date: "2026-04-08",
          totalTokens: 12500,
          promptTokens: 8200,
          completionTokens: 4300,
          estimatedCost: 0.038,
          requestCount: 5,
          byModel: {
            "gpt-4o-mini": { tokens: 8000, cost: 0.024, requests: 3 },
            "gemini-3-flash-preview": { tokens: 4500, cost: 0.014, requests: 2 },
          },
        },
        {
          date: "2026-04-07",
          totalTokens: 8700,
          promptTokens: 5800,
          completionTokens: 2900,
          estimatedCost: 0.026,
          requestCount: 3,
          byModel: {
            "gpt-4o-mini": { tokens: 8700, cost: 0.026, requests: 3 },
          },
        },
      ],
      totals: {
        totalTokens: 21200,
        promptTokens: 14000,
        completionTokens: 7200,
        estimatedCost: 0.064,
        requestCount: 8,
      },
    };
  }
  return invoke<AiUsageResponse>("fetch_ai_usage", { period, from, to });
}
