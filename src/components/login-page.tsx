import { useState } from "react";
import { APP_CONFIG } from "../lib/config";

interface LoginPageProps {
  onConnected: (session: {
    apiUrl: string; apiKey: string;
    templates: Array<{ id: string; name: string; description: string; extractionType: string; fieldCount: number; hasTableRegion: boolean }>;
  }) => void;
  savedApiKey: string | null;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function LoginPage({ onConnected, savedApiKey }: LoginPageProps) {
  const [apiKey, setApiKey] = useState(savedApiKey ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setLoading(true);
    setError(null);
    try {
      if (!isTauri) {
        await new Promise((r) => setTimeout(r, 800));
        onConnected({ apiUrl: APP_CONFIG.API_URL, apiKey,
          templates: [{ id: "t1", name: "サンプルテンプレート", description: "", extractionType: "FIELD", fieldCount: 5, hasTableRegion: false }] });
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{
        success: boolean;
        templates: Array<{ id: string; name: string; description: string; extractionType: string; fieldCount: number; hasTableRegion: boolean }>;
        error: string | null;
      }>("test_connection", { config: { apiUrl: APP_CONFIG.API_URL, apiKey: apiKey.trim() } });

      if (result.success) {
        onConnected({ apiUrl: APP_CONFIG.API_URL, apiKey: apiKey.trim(), templates: result.templates });
      } else {
        setError(result.error ?? "接続に失敗しました");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-8" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          
          <h1 className="text-xl font-bold">{APP_CONFIG.APP_NAME}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>APIキーを入力して接続</p>
        </div>

        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>APIキー</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                placeholder="pk_..." autoFocus
                className="w-full rounded-lg border px-3 py-2.5 font-mono text-sm transition focus:outline-none focus:ring-2"
                style={{ background: "var(--background)", borderColor: "var(--input)", color: "var(--foreground)" }}
                onKeyDown={(e) => e.key === "Enter" && apiKey && handleConnect()} />
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                Web管理画面の「設定 → APIキー」から発行できます
              </p>
            </div>

            {error && (
              <div className="rounded-lg px-3 py-2.5 text-sm"
                style={{ background: "oklch(0.577 0.245 27.325 / 0.1)", color: "var(--destructive)" }}>
                {error}
              </div>
            )}

            <button onClick={handleConnect} disabled={!apiKey.trim() || loading}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-50"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  接続中...
                </span>
              ) : "接続"}
            </button>
          </div>
        </div>

        <p className="text-center text-[10px]" style={{ color: "var(--muted-foreground)" }}>v{APP_CONFIG.VERSION}</p>
      </div>
    </div>
  );
}
