import React, { useEffect, useState } from "react";
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

export function DashboardPage({ profiles, templates: _templates, connected, onNavigate, onProfilesChanged, onRefreshTemplates: _onRefreshTemplates, loadingTemplates: _loadingTemplates }: DashboardPageProps) {
  const [recentLogs, setRecentLogs] = useState<ProcessingLog[]>([]);
  const [liveEvents, setLiveEvents] = useState<WatchEventPayload[]>([]);
  const activeCount = profiles.filter((p) => p.isActive).length;

  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const todayLogs = recentLogs.filter((l) => l.createdAt.startsWith(today));
  const monthLogs = recentLogs.filter((l) => l.createdAt.startsWith(currentMonth));
  const todayProcessed = todayLogs.length;
  const monthProcessed = monthLogs.length;
  const todayErrors = todayLogs.filter((l) => l.status === "FAILED").length;

  useEffect(() => {
    void getProcessingLogs(8).then(setRecentLogs).catch(() => {});
  }, []);

  // Listen for watch events from the Rust backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<WatchEventPayload>("watch-event", (event) => {
          const payload = event.payload;
          setLiveEvents((prev) => [payload, ...prev].slice(0, 20));
        });
      } catch {
        // Not in Tauri environment
      }
    })();

    return () => { unlisten?.(); };
  }, []);

  async function handleToggle(id: string, active: boolean) {
    try {
      await toggleProfileActive(id, active);
      onProfilesChanged(profiles.map((p) => p.id === id ? { ...p, isActive: active } : p));
    } catch {
      // UI already reflects previous state on failure
    }
  }

  async function handleStartAll() {
    const inactive = profiles.filter((p) => !p.isActive);
    await Promise.allSettled(inactive.map((p) => toggleProfileActive(p.id, true)));
    onProfilesChanged(profiles.map((p) => ({ ...p, isActive: true })));
  }

  async function handleStopAll() {
    const active = profiles.filter((p) => p.isActive);
    await Promise.allSettled(active.map((p) => toggleProfileActive(p.id, false)));
    onProfilesChanged(profiles.map((p) => ({ ...p, isActive: false })));
  }

  function getEventStep(eventType: string): { label: string; color: string } {
    switch (eventType) {
      case "file_detected": return { label: "検出", color: "#f59e0b" };
      case "processing": return { label: "処理中", color: "#6366f1" };
      case "completed": return { label: "完了", color: "#22c55e" };
      case "error": return { label: "エラー", color: "var(--destructive)" };
      default: return { label: "", color: "var(--muted-foreground)" };
    }
  }

  function getLastProcessedLabel(profileId: string): string | null {
    const log = recentLogs.find((l) => l.profileId === profileId);
    if (!log) return null;
    const diff = Date.now() - new Date(log.createdAt).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "最後の処理: たった今";
    if (minutes < 60) return `最後の処理: ${minutes}分前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `最後の処理: ${hours}時間前`;
    const days = Math.floor(hours / 24);
    return `最後の処理: ${days}日前`;
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
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>自動処理の状態</p>
      </div>

      {/* ステータスバナー */}
      {profiles.length > 0 && (() => {
        let statusTitle: string;
        let statusDetail: string;
        let statusColor: string;
        let statusBannerBg: string;
        let statusBannerBorder: string;
        let statusDotClass: string;

        if (activeCount > 0 && todayErrors === 0) {
          statusTitle = "正常に稼働しています";
          const latestLog = recentLogs[0];
          if (latestLog) {
            const diff = Date.now() - new Date(latestLog.createdAt).getTime();
            const minutes = Math.floor(diff / 60000);
            let relative: string;
            if (minutes < 1) relative = "たった今";
            else if (minutes < 60) relative = `${minutes}分前`;
            else if (minutes < 1440) relative = `${Math.floor(minutes / 60)}時間前`;
            else relative = `${Math.floor(minutes / 1440)}日前`;
            statusDetail = `最後の処理: ${relative}`;
          } else {
            statusDetail = "フォルダを監視中です";
          }
          statusColor = "oklch(0.6 0.15 155)";
          statusBannerBg = "oklch(0.6 0.15 155 / 0.05)";
          statusBannerBorder = "oklch(0.6 0.15 155 / 0.2)";
          statusDotClass = "bg-emerald-500 animate-pulse-dot";
        } else if (activeCount > 0 && todayErrors > 0) {
          statusTitle = "稼働中ですが、エラーがあります";
          statusDetail = `今日 ${todayErrors}件のエラーが発生しています。処理履歴を確認してください`;
          statusColor = "#f59e0b";
          statusBannerBg = "oklch(0.75 0.15 85 / 0.05)";
          statusBannerBorder = "oklch(0.75 0.15 85 / 0.2)";
          statusDotClass = "bg-amber-500";
        } else {
          statusTitle = "すべて停止中です";
          statusDetail = "設定を有効にして監視を開始してください";
          statusColor = "var(--muted-foreground)";
          statusBannerBg = "var(--secondary)";
          statusBannerBorder = "var(--border)";
          statusDotClass = "bg-gray-400";
        }

        return (
          <div className="mb-5 rounded-xl border p-4" style={{
            background: statusBannerBg, borderColor: statusBannerBorder
          }}>
            <div className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${statusDotClass}`} />
              <div>
                <p className="text-sm font-semibold" style={{ color: statusColor }}>{statusTitle}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{statusDetail}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Stats */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          { label: "今日の処理数", value: todayProcessed, color: "oklch(0.488 0.243 264.376)" },
          { label: "今月の処理数", value: monthProcessed, color: "var(--foreground)" },
          { label: "稼働中", value: activeCount, color: "oklch(0.6 0.15 155)" },
          { label: "今日のエラー", value: todayErrors, color: "var(--destructive)" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{label}</p>
            <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Profile Cards */}
      {profiles.length === 0 ? (
        <div className="rounded-xl p-8 text-center border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="mx-auto max-w-md">
            <h3 className="text-base font-semibold mb-2">自動処理の設定を作成しましょう</h3>
            <p className="text-sm mb-6" style={{ color: "var(--muted-foreground)" }}>
              約2分で設定が完了します
            </p>

            <div className="flex items-center justify-center gap-4 mb-6">
              {[
                { step: "1", title: "フォルダにPDFを入れる", desc: "スキャンしたPDFを指定フォルダに保存" },
                { step: "2", title: "自動で読み取り", desc: "AIが帳票データを抽出" },
                { step: "3", title: "CSVで出力", desc: "結果がCSVファイルとして保存" },
              ].map((item, i) => (
                <React.Fragment key={item.step}>
                  <div className="flex flex-col items-center text-center w-28">
                    <div className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold mb-2"
                      style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
                      {item.step}
                    </div>
                    <p className="text-xs font-medium">{item.title}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{item.desc}</p>
                  </div>
                  {i < 2 && (
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--muted-foreground)" }}>
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  )}
                </React.Fragment>
              ))}
            </div>

            <button onClick={() => onNavigate("profiles")}
              className="rounded-lg px-6 py-2.5 text-sm font-medium"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
              設定を作成する
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">自動処理の設定</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => void handleStartAll()}
                className="rounded-lg px-3 py-1 text-xs font-medium transition"
                style={{ background: "oklch(0.6 0.15 155 / 0.1)", color: "oklch(0.6 0.15 155)" }}>
                全て開始
              </button>
              <button onClick={() => void handleStopAll()}
                className="rounded-lg px-3 py-1 text-xs font-medium transition"
                style={{ background: "oklch(0.577 0.245 27.325 / 0.1)", color: "var(--destructive)" }}>
                全て停止
              </button>
              <button onClick={() => onNavigate("profiles")} className="text-xs font-medium" style={{ color: "var(--sidebar-primary)" }}>管理</button>
            </div>
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
                    role="switch"
                    aria-checked={p.isActive}
                    aria-label={`${p.name} の監視を${p.isActive ? "停止" : "開始"}`}
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
                    {(() => {
                      const label = getLastProcessedLabel(p.id);
                      return label ? <p className="mt-1 text-[10px]" style={{ color: "var(--muted-foreground)" }}>{label}</p> : null;
                    })()}
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
            <h2 className="text-sm font-semibold">リアルタイム処理状況</h2>
          </div>
          <div className="divide-y rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            {liveEvents.slice(0, 10).map((evt, i) => {
              const step = getEventStep(evt.eventType);
              return (
                <div key={`${evt.fileName}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-10 text-center text-[10px] font-bold rounded-full px-1.5 py-0.5"
                    style={{ background: step.color + "20", color: step.color }}>
                    {step.label}
                  </span>
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

      {/* 月次サマリー */}
      {monthProcessed > 0 && (
        <div className="mt-5 mb-5 rounded-xl border p-4" style={{ background: "oklch(0.6 0.15 155 / 0.05)", borderColor: "oklch(0.6 0.15 155 / 0.2)" }}>
          <p className="text-sm font-semibold" style={{ color: "oklch(0.6 0.15 155)" }}>
            今月の成果
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
            {currentMonth.replace("-", "年")}月: {monthProcessed}件の帳票を自動処理しました。
            {monthProcessed >= 10 && ` 手作業の場合、約${Math.round(monthProcessed * 3)}分に相当します。`}
          </p>
        </div>
      )}

      {/* 最近の処理 */}
      {recentLogs.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">最近の処理結果</h2>
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
