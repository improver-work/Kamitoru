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
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<"24h" | "7d" | "30d" | "all">("all");
  const [selectedLog, setSelectedLog] = useState<ProcessingLog | null>(null);

  useEffect(() => { void getProcessingLogs(100).then(setLogs).catch(() => {}); }, []);

  const filtered = logs
    .filter((l) => statusFilter === "all" || l.status === statusFilter)
    .filter((l) => profileFilter === "all" || l.profileId === profileFilter)
    .filter((l) => !search || l.fileName.toLowerCase().includes(search.toLowerCase()))
    .filter((l) => {
      if (dateFilter === "all") return true;
      const logDate = new Date(l.createdAt).getTime();
      const now = Date.now();
      switch (dateFilter) {
        case "24h": return now - logDate < 24 * 60 * 60 * 1000;
        case "7d": return now - logDate < 7 * 24 * 60 * 60 * 1000;
        case "30d": return now - logDate < 30 * 24 * 60 * 60 * 1000;
        default: return true;
      }
    });

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

      {/* Search */}
      <div className="mb-3">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="ファイル名で検索..."
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--foreground)" }} />
      </div>

      {/* Status Tabs + Date Filter */}
      <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex gap-1">
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
      <div className="flex gap-1">
        {(["24h", "7d", "30d", "all"] as const).map((d) => {
          const active = dateFilter === d;
          const label = d === "24h" ? "24時間" : d === "7d" ? "7日" : d === "30d" ? "30日" : "すべて";
          return (
            <button key={d} onClick={() => setDateFilter(d)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition"
              style={{
                background: active ? "var(--primary)" : "transparent",
                color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
              }}>
              {label}
            </button>
          );
        })}
      </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10" style={{ background: "var(--secondary)" }}>
            <tr>
              {["日時", "ファイル", "設定名", "ステータス", "項目数", "処理時間"].map((h, i) => (
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
                <tr key={log.id} className="border-t transition cursor-pointer hover:opacity-80" style={{ borderColor: "var(--border)" }} onClick={() => setSelectedLog(log)}>
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

      {/* Footer count */}
      <div className="mt-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
        {logs.length}件中 {filtered.length}件を表示
      </div>

      {/* Detail Modal */}
      {selectedLog && (() => {
        const cfg = STATUS_CFG[selectedLog.status] ?? STATUS_CFG.SKIPPED;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setSelectedLog(null)}>
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative w-full max-w-md rounded-xl border p-6" onClick={(e) => e.stopPropagation()}
              style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h3 className="text-base font-semibold mb-4">処理詳細</h3>

              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>ファイル名</p>
                  <p className="font-medium break-all">{selectedLog.fileName}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>ステータス</p>
                    <span className="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: cfg.bg, color: cfg.fg }}>{cfg.label}</span>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>設定名</p>
                    <p>{selectedLog.profileName}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>抽出項目数</p>
                    <p>{selectedLog.resultCount}項目</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>処理時間</p>
                    <p>{(selectedLog.processingTimeMs / 1000).toFixed(1)}秒</p>
                  </div>
                </div>
                {selectedLog.jobId && (
                  <div>
                    <p className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>ジョブID</p>
                    <p className="font-mono text-xs break-all">{selectedLog.jobId}</p>
                  </div>
                )}
                {selectedLog.error && (
                  <div>
                    <p className="text-[11px] font-medium" style={{ color: "var(--destructive)" }}>エラー内容</p>
                    <p className="text-sm rounded-lg p-3" style={{ background: "oklch(0.577 0.245 27.325 / 0.05)" }}>
                      {selectedLog.error}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>処理日時</p>
                  <p>{new Date(selectedLog.createdAt).toLocaleString("ja-JP")}</p>
                </div>
              </div>

              <button onClick={() => setSelectedLog(null)}
                className="mt-4 w-full rounded-lg py-2 text-sm font-medium"
                style={{ background: "var(--secondary)", color: "var(--foreground)" }}>
                閉じる
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
