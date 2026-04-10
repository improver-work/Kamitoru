import { useState, useEffect } from "react";
import { type WatchProfile, type ProcessingLog, getProcessingLogs } from "../lib/tauri-api";

interface LogPageProps { profiles: WatchProfile[]; }

const STATUS_CFG: Record<string, { label: string; bg: string; fg: string }> = {
  SUCCESS: { label: "成功", bg: "oklch(0.6 0.15 155 / 0.1)", fg: "oklch(0.6 0.15 155)" },
  PARTIAL: { label: "一部成功", bg: "oklch(0.7 0.15 85 / 0.1)", fg: "oklch(0.6 0.15 85)" },
  FAILED:  { label: "失敗",  bg: "oklch(0.577 0.245 27.325 / 0.1)", fg: "var(--destructive)" },
  SKIPPED: { label: "スキップ", bg: "var(--secondary)", fg: "var(--muted-foreground)" },
};

export function LogPage({ profiles }: LogPageProps) {
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [profileFilter, setProfileFilter] = useState("all");

  useEffect(() => { void getProcessingLogs(100).then(setLogs).catch(() => {}); }, []);

  const filtered = logs
    .filter((l) => statusFilter === "all" || l.status === statusFilter)
    .filter((l) => profileFilter === "all" || l.profileId === profileFilter);

  const counts: Record<string, number> = { all: logs.length };
  for (const l of logs) counts[l.status] = (counts[l.status] ?? 0) + 1;

  return (
    <div className="flex h-full flex-col p-6">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">処理ログ</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>処理履歴の確認</p>
        </div>
        <select value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-xs"
          style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--foreground)" }}>
          <option value="all">すべての設定</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Status Tabs */}
      <div className="mb-3 flex gap-1">
        {(["all", "SUCCESS", "PARTIAL", "FAILED"] as const).map((s) => {
          const active = statusFilter === s;
          const label = s === "all" ? "すべて" : STATUS_CFG[s]?.label ?? s;
          return (
            <button key={s} onClick={() => setStatusFilter(s)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition"
              style={{
                background: active ? "var(--primary)" : "transparent",
                color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
              }}>
              {label} ({counts[s] ?? 0})
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10" style={{ background: "var(--secondary)" }}>
            <tr>
              {["日時", "ファイル", "プロファイル", "ステータス", "項目数", "処理時間"].map((h, i) => (
                <th key={h} className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider ${i >= 4 ? "text-right" : i === 3 ? "text-center" : "text-left"}`}
                  style={{ color: "var(--muted-foreground)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>ログがありません</td></tr>
            ) : filtered.map((log) => {
              const cfg = STATUS_CFG[log.status] ?? STATUS_CFG.SKIPPED;
              return (
                <tr key={log.id} className="border-t transition" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
                    {new Date(log.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="max-w-[180px] truncate px-4 py-2.5 font-medium">{log.fileName}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--muted-foreground)" }}>{log.profileName}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: cfg.bg, color: cfg.fg }}>{cfg.label}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">{log.resultCount}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--muted-foreground)" }}>{(log.processingTimeMs / 1000).toFixed(1)}s</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
