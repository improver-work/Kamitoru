import { useState } from "react";
import { APP_CONFIG } from "../lib/config";
import { type Template, testConnection } from "../lib/tauri-api";

interface LoginPageProps {
  onConnected: (session: { apiUrl: string; apiKey: string; templates: Template[] }) => void;
}

function friendlyError(error: string): string {
  if (error.includes("401") || error.includes("403") || error.includes("Unauthorized") || error.includes("Forbidden")) {
    return "APIキーが正しくないか、期限切れの可能性があります。Web管理画面で新しいキーを発行してお試しください。";
  }
  if (error.includes("Connection error") || error.includes("timeout") || error.includes("network")) {
    return "サーバーに接続できません。インターネット接続を確認してください。";
  }
  if (error.includes("ENOTFOUND") || error.includes("DNS")) {
    return "サーバーが見つかりません。ネットワーク接続を確認してください。";
  }
  return `接続エラー: ${error}`;
}

export function LoginPage({ onConnected }: LoginPageProps) {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  async function handleConnect() {
    setLoading(true);
    setError(null);
    try {
      const result = await testConnection({ apiUrl: APP_CONFIG.API_URL, apiKey: apiKey.trim() });

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
          <p className="mt-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
            フォルダにPDFを入れるだけ。帳票データを自動で読み取り、CSVに変換します。
          </p>
        </div>

        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="space-y-4">
            <div>
              <h2 className="mb-1 text-sm font-semibold">接続設定</h2>
              <p className="mb-3 text-xs" style={{ color: "var(--muted-foreground)" }}>
                Web管理画面でAPIキーを発行し、下の入力欄にペーストしてください。
              </p>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>APIキー</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                placeholder="pk_..." autoFocus
                className="w-full rounded-lg border px-3 py-2.5 font-mono text-sm transition focus:outline-none focus:ring-2"
                style={{ background: "var(--background)", borderColor: "var(--input)", color: "var(--foreground)" }}
                onKeyDown={(e) => e.key === "Enter" && apiKey && handleConnect()} />
            </div>

            {error && (
              <div className="rounded-lg px-3 py-2.5 text-sm"
                style={{ background: "oklch(0.577 0.245 27.325 / 0.1)", color: "var(--destructive)" }}>
                {friendlyError(error)}
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

        {/* Help section */}
        <div className="space-y-2">
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="mx-auto flex items-center gap-1 text-xs font-medium transition"
            style={{ color: "var(--muted-foreground)" }}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {showHelp ? <path d="M19 9l-7 7-7-7" /> : <path d="M9 5l7 7-7 7" />}
            </svg>
            APIキーの取得方法
          </button>
          {showHelp && (
            <div className="rounded-xl border p-4 text-sm" style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--foreground)" }}>
              <ol className="space-y-2 list-decimal list-inside" style={{ color: "var(--muted-foreground)" }}>
                <li>Web管理画面にログインします</li>
                <li>「設定」メニューを開きます</li>
                <li>「APIキー」セクションで「新しいキーを発行」をクリックします</li>
                <li>表示されたキー（pk_で始まる文字列）をコピーします</li>
                <li>上の入力欄にペーストして「接続」を押します</li>
              </ol>
            </div>
          )}
        </div>

        <p className="text-center text-[10px]" style={{ color: "var(--muted-foreground)" }}>v{APP_CONFIG.VERSION}</p>
      </div>
    </div>
  );
}
