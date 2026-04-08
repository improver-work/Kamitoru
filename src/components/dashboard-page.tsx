import { useEffect, useState } from "react";
import type { Page } from "../App";
import { type WatchProfile, type Template, type ProcessingLog, toggleProfileActive, getProcessingLogs } from "../lib/tauri-api";

interface DashboardPageProps {
  profiles: WatchProfile[];
  templates: Template[];
  connected: boolean;
  onNavigate: (page: Page) => void;
  onProfilesChanged: (profiles: WatchProfile[]) => void;
  onRefreshTemplates: () => Promise<void>;
  loadingTemplates: boolean;
}

interface WatchEventPayload {
  profileId: string;
  eventType: string;
  fileName: string;
  message: string;
  jobId?: string;
  resultCount?: number;
  processingTimeMs?: number;
}

export function DashboardPage({ profiles, templates, connected, onNavigate, onProfilesChanged, onRefreshTemplates, loadingTemplates }: DashboardPageProps) {
  const [recentLogs, setRecentLogs] = useState<ProcessingLog[]>([]);
  const [liveEvents, setLiveEvents] = useState<WatchEventPayload[]>([]);
  const activeCount = profiles.filter((p) => p.isActive).length;

  useEffect(() => {
    void getProcessingLogs(8).then(setRecentLogs).catch(() => {});
  }, []);

  // Auto-fetch templates when connected but templates are empty
  useEffect(() => {
    if (connected && templates.length === 0) {
      void onRefreshTemplates();
    }
  }, [connected, templates.length, onRefreshTemplates]);

  // Listen for watch events from the Rust backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<WatchEventPayload>("watch-event", (event) => {
          const payload = event.payload;
          console.log("[WatchEvent]", payload);
          setLiveEvents((prev) => [payload, ...prev].slice(0, 20));
        });
      } catch {
        // Not in Tauri environment
      }
    })();

    return () => { unlisten?.(); };
  }, []);

  async function handleToggle(id: string, active: boolean) {
    await toggleProfileActive(id, active);
    onProfilesChanged(profiles.map((p) => p.id === id ? { ...p, isActive: active } : p));
  }

  if (!connected) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="mx-auto max-w-sm rounded-xl p-8 text-center border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <h2 className="mb-2 text-base font-semibold">未接続</h2>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>APIキーで接続してください</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold tracking-tight">ダッシュボード</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>監視プロファイルの状態</p>
      </div>

      {/* Stats */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: "テンプレート", value: templates.length, color: "oklch(0.488 0.243 264.376)" },
          { label: "プロファイル", value: profiles.length, color: "var(--foreground)" },
          { label: "稼働中", value: activeCount, color: "oklch(0.6 0.15 155)" },
          { label: "エラー", value: recentLogs.filter((l) => l.status === "FAILED").length, color: "var(--destructive)" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{label}</p>
            <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Templates Section */}
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">利用可能なテンプレート</h2>
          <button
            onClick={() => void onRefreshTemplates()}
            disabled={loadingTemplates}
            className="rounded-lg px-3 py-1 text-xs font-medium transition"
            style={{ color: "var(--sidebar-primary)" }}
          >
            {loadingTemplates ? "取得中..." : "更新"}
          </button>
        </div>
        {templates.length === 0 ? (
          <div className="rounded-xl border p-6 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {loadingTemplates ? "テンプレートを取得中..." : "テンプレートがありません。Web管理画面でテンプレートを作成してください。"}
            </p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-xl border p-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium">{t.name}</h3>
                    {t.description && (
                      <p className="mt-0.5 truncate text-xs" style={{ color: "var(--muted-foreground)" }}>{t.description}</p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: "oklch(0.488 0.243 264.376 / 0.1)", color: "oklch(0.488 0.243 264.376)" }}>
                    {t.extractionType}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    {t.fieldCount} fields
                  </span>
                  {t.hasTableRegion && (
                    <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>+ table</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Profile Cards */}
      {profiles.length === 0 ? (
        <div className="rounded-xl p-8 text-center border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <p className="mb-3 text-sm" style={{ color: "var(--muted-foreground)" }}>監視プロファイルがありません</p>
          <button onClick={() => onNavigate("profiles")} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
            プロファイルを作成
          </button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">監視プロファイル</h2>
            <button onClick={() => onNavigate("profiles")} className="text-xs font-medium" style={{ color: "var(--sidebar-primary)" }}>管理</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {profiles.map((p) => (
              <div key={p.id} className="overflow-hidden rounded-xl border transition-all" style={{ background: "var(--card)", borderColor: p.isActive ? "oklch(0.6 0.15 155 / 0.4)" : "var(--border)" }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ background: p.isActive ? "oklch(0.6 0.15 155 / 0.08)" : "var(--secondary)" }}>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${p.isActive ? "bg-emerald-500 animate-pulse-dot" : ""}`}
                      style={{ background: p.isActive ? undefined : "var(--muted-foreground)" }} />
                    <h3 className="text-sm font-semibold">{p.name}</h3>
                  </div>
                  <button
                    onClick={() => handleToggle(p.id, !p.isActive)}
                    className="relative h-5 w-9 rounded-full transition-colors"
                    style={{ background: p.isActive ? "oklch(0.6 0.15 155)" : "var(--muted)" }}
                  >
                    <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                      style={{ left: p.isActive ? "18px" : "2px" }} />
                  </button>
                </div>
                <div className="space-y-1.5 px-4 py-3">
                  <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: "oklch(0.488 0.243 264.376 / 0.1)", color: "oklch(0.488 0.243 264.376)" }}>
                    {p.templateName}
                  </span>
                  <div className="space-y-0.5 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    <p><span className="font-medium" style={{ color: "var(--foreground)" }}>入力:</span> {p.inputFolder}</p>
                    <p><span className="font-medium" style={{ color: "var(--foreground)" }}>出力:</span> {p.outputFolder}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Live Watch Events */}
      {liveEvents.length > 0 && (
        <div className="mt-5">
          <div className="mb-2">
            <h2 className="text-sm font-semibold">リアルタイム処理</h2>
          </div>
          <div className="divide-y rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            {liveEvents.slice(0, 10).map((evt, i) => {
              const dotColor =
                evt.eventType === "completed" ? "bg-emerald-500"
                : evt.eventType === "error" ? "bg-red-500"
                : evt.eventType === "processing" ? "bg-blue-500 animate-pulse-dot"
                : "bg-amber-500";
              return (
                <div key={`${evt.fileName}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                  <span className="flex-1 truncate text-sm">{evt.message}</span>
                  {evt.processingTimeMs && (
                    <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{(evt.processingTimeMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 最近の処理 */}
      {recentLogs.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">最近の処理</h2>
            <button onClick={() => onNavigate("logs")} className="text-xs font-medium" style={{ color: "var(--sidebar-primary)" }}>すべて表示</button>
          </div>
          <div className="divide-y rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            {recentLogs.slice(0, 5).map((log) => (
              <div key={log.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className={`h-1.5 w-1.5 rounded-full ${log.status === "SUCCESS" ? "bg-emerald-500" : log.status === "PARTIAL" ? "bg-amber-500" : "bg-red-500"}`} />
                <span className="flex-1 truncate text-sm">{log.fileName}</span>
                <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{log.profileName}</span>
                <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{(log.processingTimeMs / 1000).toFixed(1)}s</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
