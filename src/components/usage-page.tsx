import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAiUsage } from "../lib/tauri-api";

export function UsagePage() {
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");

  const { data: usage, isLoading } = useQuery({
    queryKey: ["ai-usage", period],
    queryFn: () => getAiUsage(period),
  });

  // USD → JPY換算（概算レート）
  const USD_TO_JPY = 150;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">AI利用状況</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>トークン使用量と概算コスト</p>
        </div>
        {/* 期間切替 */}
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "var(--secondary)" }}>
          {(["daily", "monthly"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ background: period === p ? "var(--background)" : "transparent", color: period === p ? "var(--foreground)" : "var(--muted-foreground)" }}>
              {p === "daily" ? "日別" : "月別"}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </div>
      ) : usage ? (
        <>
          {/* 合計カード */}
          <div className="mb-5 grid grid-cols-4 gap-3">
            {[
              { label: "総リクエスト", value: usage.totals.requestCount.toLocaleString(), color: "oklch(0.488 0.243 264.376)" },
              { label: "総トークン", value: usage.totals.totalTokens.toLocaleString(), color: "var(--foreground)" },
              { label: "概算コスト (USD)", value: `$${usage.totals.estimatedCost.toFixed(3)}`, color: "oklch(0.6 0.15 155)" },
              { label: "概算コスト (JPY)", value: `${Math.round(usage.totals.estimatedCost * USD_TO_JPY).toLocaleString()}`, color: "oklch(0.7 0.15 60)" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{label}</p>
                <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>

          {/* 日別/月別テーブル */}
          <div className="mb-5">
            <h2 className="mb-2 text-sm font-semibold">{period === "daily" ? "日別" : "月別"}利用量</h2>
            <div className="divide-y rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              {/* ヘッダー */}
              <div className="grid grid-cols-5 gap-2 px-4 py-2.5 text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                <span>日付</span>
                <span className="text-right">リクエスト</span>
                <span className="text-right">トークン</span>
                <span className="text-right">USD</span>
                <span className="text-right">JPY</span>
              </div>
              {usage.data.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
                  データがありません
                </div>
              ) : (
                usage.data.map((entry) => (
                  <div key={entry.date} className="grid grid-cols-5 gap-2 px-4 py-2.5 text-sm">
                    <span className="font-medium">{entry.date}</span>
                    <span className="text-right" style={{ color: "var(--muted-foreground)" }}>{entry.requestCount}</span>
                    <span className="text-right" style={{ color: "var(--muted-foreground)" }}>{entry.totalTokens.toLocaleString()}</span>
                    <span className="text-right font-medium" style={{ color: "oklch(0.6 0.15 155)" }}>${entry.estimatedCost.toFixed(3)}</span>
                    <span className="text-right font-medium" style={{ color: "oklch(0.7 0.15 60)" }}>{Math.round(entry.estimatedCost * USD_TO_JPY).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* モデル別内訳（最新日のみ） */}
          {usage.data.length > 0 && Object.keys(usage.data[0].byModel).length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold">モデル別内訳（{usage.data[0].date}）</h2>
              <div className="divide-y rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="grid grid-cols-4 gap-2 px-4 py-2.5 text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                  <span>モデル</span>
                  <span className="text-right">リクエスト</span>
                  <span className="text-right">トークン</span>
                  <span className="text-right">コスト</span>
                </div>
                {Object.entries(usage.data[0].byModel).map(([model, info]) => (
                  <div key={model} className="grid grid-cols-4 gap-2 px-4 py-2.5 text-sm">
                    <span className="truncate font-medium">{model}</span>
                    <span className="text-right" style={{ color: "var(--muted-foreground)" }}>{info.requests}</span>
                    <span className="text-right" style={{ color: "var(--muted-foreground)" }}>{info.tokens.toLocaleString()}</span>
                    <span className="text-right font-medium" style={{ color: "oklch(0.6 0.15 155)" }}>${info.cost.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
