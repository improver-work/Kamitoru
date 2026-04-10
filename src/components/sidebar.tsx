import type { Page } from "../App";
import { APP_CONFIG } from "../lib/config";

interface ThemeCtx {
  theme: string;
  resolved: string;
  setTheme: (t: "light" | "dark" | "system") => void;
}

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  connected: boolean;
  activeProfileCount: number;
  totalProfileCount: number;
  templateCount: number;
  onDisconnect: () => void;
  theme: ThemeCtx;
}

const NAV_ITEMS: { page: Page; label: string; iconPath: string }[] = [
  { page: "dashboard", label: "ダッシュボード", iconPath: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
  { page: "profiles", label: "自動処理の設定", iconPath: "M12 2 2 7l10 5 10-5zm0 13 10-5m-10 5L2 12m10 5L2 17l10 5 10-5" },
  { page: "logs", label: "処理履歴", iconPath: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v5h5M10 13H8M16 17H8" },
  { page: "usage", label: "利用量・コスト", iconPath: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
];

export function Sidebar({ currentPage, onNavigate, connected, activeProfileCount, totalProfileCount, templateCount: _templateCount, onDisconnect, theme }: SidebarProps) {
  const status = !connected ? "disconnected"
    : activeProfileCount > 0 ? "active"
    : totalProfileCount > 0 ? "stopped"
    : "setup";

  const statusConfig = {
    disconnected: { bg: "var(--secondary)", color: "var(--muted-foreground)", dot: "", text: "未接続" },
    active: { bg: "oklch(0.6 0.15 155 / 0.1)", color: "oklch(0.6 0.15 155)", dot: "bg-emerald-500 animate-pulse-dot", text: `稼働中 - ${activeProfileCount}件を監視中` },
    stopped: { bg: "oklch(0.7 0.15 60 / 0.1)", color: "oklch(0.7 0.15 60)", dot: "", text: "停止中 - 監視は行われていません" },
    setup: { bg: "oklch(0.488 0.243 264.376 / 0.1)", color: "oklch(0.488 0.243 264.376)", dot: "", text: "設定を開始してください" },
  };

  const { bg: statusBg, color: statusColor, dot: statusDotClass, text: statusText } = statusConfig[status];

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r"
      style={{ background: "var(--sidebar)", borderColor: "var(--sidebar-border)", color: "var(--sidebar-foreground)" }}>

      {/* ロゴ */}
      <div className="flex h-14 items-center px-4" data-tauri-drag-region>
        <div>
          <p className="text-[14px] font-bold">カミトル</p>
          <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>デスクトップ</p>
        </div>
      </div>

      {/* 全体ステータス */}
      <div className="mx-2 mb-2 rounded-lg px-3 py-2" style={{ background: statusBg }}>
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${statusDotClass}`}
            style={{ background: statusDotClass ? undefined : status === "disconnected" ? "var(--muted-foreground)" : status === "stopped" ? "oklch(0.7 0.15 60)" : "oklch(0.488 0.243 264.376)" }} />
          <span className="text-[11px] font-medium" style={{ color: statusColor }}>
            {statusText}
          </span>
        </div>
      </div>

      {/* ナビゲーション */}
      <nav className="flex-1 px-2 py-3">
        <div className="space-y-0.5">
          {NAV_ITEMS.map(({ page, label, iconPath }) => {
            const active = currentPage === page;
            return (
              <button key={page} onClick={() => onNavigate(page)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors"
                style={{ background: active ? "var(--accent)" : "transparent", color: active ? "var(--accent-foreground)" : "var(--muted-foreground)" }}>
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={iconPath} />
                </svg>
                {label}
                {page === "dashboard" && activeProfileCount > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold text-white">
                    {activeProfileCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* フッター */}
      <div className="border-t px-3 py-3" style={{ borderColor: "var(--sidebar-border)" }}>
        {/* テーマ切替 */}
        <div className="mb-3 flex items-center gap-1 rounded-lg p-0.5" style={{ background: "var(--secondary)" }}>
          {(["light", "dark", "system"] as const).map((t) => (
            <button key={t} onClick={() => theme.setTheme(t)}
              className="flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors"
              style={{ background: theme.theme === t ? "var(--background)" : "transparent", color: theme.theme === t ? "var(--foreground)" : "var(--muted-foreground)" }}>
              {t === "light" ? "ライト" : t === "dark" ? "ダーク" : "自動"}
            </button>
          ))}
        </div>

        {/* 接続状態 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse-dot" : ""}`}
              style={{ background: connected ? undefined : "var(--muted-foreground)" }} />
            <span className="text-[11px] font-medium" style={{ color: connected ? "oklch(0.6 0.15 155)" : "var(--muted-foreground)" }}>
              {connected ? "接続中" : "未接続"}
            </span>
          </div>
          <button onClick={onDisconnect} className="rounded px-1.5 py-0.5 text-[10px] font-medium transition hover:opacity-80"
            style={{ color: "var(--muted-foreground)" }}>
            切断
          </button>
        </div>
        <p className="mt-1 text-[10px]" style={{ color: "var(--muted-foreground)" }}>v{APP_CONFIG.VERSION}</p>
      </div>
    </aside>
  );
}
