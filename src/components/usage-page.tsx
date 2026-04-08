import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAiUsage } from "../lib/tauri-api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
  AreaChart, Area,
} from "recharts";

const CHART_COLORS = [
  "oklch(0.6 0.2 264)",   // blue
  "oklch(0.65 0.18 155)", // green
  "oklch(0.7 0.15 60)",   // amber
  "oklch(0.6 0.2 330)",   // pink
  "oklch(0.65 0.15 200)", // cyan
  "oklch(0.6 0.18 30)",   // orange
];

const USD_TO_JPY = 150;

export function UsagePage() {
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");

  const { data: usage, isLoading } = useQuery({
    queryKey: ["ai-usage", period],
    queryFn: () => getAiUsage(period),
  });

  // チャート用データ（日付昇順）
  const chartData = useMemo(() => {
    if (!usage?.data) return [];
    return [...usage.data].reverse().map((d) => ({
      date: d.date.slice(5), // "04-08" format
      fullDate: d.date,
      promptTokens: d.promptTokens,
      completionTokens: d.completionTokens,
      totalTokens: d.totalTokens,
      cost: d.estimatedCost,
      costJpy: Math.round(d.estimatedCost * USD_TO_JPY),
      requests: d.requestCount,
    }));
  }, [usage]);

  // モデル別集計（全期間合算）
  const modelData = useMemo(() => {
    if (!usage?.data) return [];
    const map = new Map<string, { tokens: number; cost: number; requests: number }>();
    for (const day of usage.data) {
      for (const [model, info] of Object.entries(day.byModel)) {
        const existing = map.get(model) ?? { tokens: 0, cost: 0, requests: 0 };
        existing.tokens += info.tokens;
        existing.cost += info.cost;
        existing.requests += info.requests;
        map.set(model, existing);
      }
    }
    return Array.from(map.entries())
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => b.tokens - a.tokens);
  }, [usage]);

  const tooltipStyle = {
    contentStyle: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      fontSize: "12px",
      color: "var(--foreground)",
    },
    labelStyle: { color: "var(--foreground)", fontWeight: 600 },
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">AI利用状況</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>トークン使用量と概算コスト</p>
        </div>
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
              { label: "概算コスト (JPY)", value: `\u00A5${Math.round(usage.totals.estimatedCost * USD_TO_JPY).toLocaleString()}`, color: "oklch(0.7 0.15 60)" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{label}</p>
                <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>

          {/* トークン使用量グラフ（棒グラフ） */}
          {chartData.length > 0 && (
            <div className="mb-5 rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h2 className="mb-3 text-sm font-semibold">トークン使用量</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <Tooltip {...tooltipStyle} formatter={(value: unknown, name: unknown) => [Number(value).toLocaleString(), name === "promptTokens" ? "入力" : "出力"]} labelFormatter={(l: unknown) => `日付: ${l}`} />
                  <Legend formatter={(value: unknown) => value === "promptTokens" ? "入力トークン" : "出力トークン"} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="promptTokens" stackId="tokens" fill="oklch(0.6 0.2 264)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="completionTokens" stackId="tokens" fill="oklch(0.65 0.18 155)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* コスト推移グラフ + モデル別円グラフ */}
          <div className="mb-5 grid grid-cols-2 gap-3">
            {/* コスト推移（エリアチャート） */}
            {chartData.length > 0 && (
              <div className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <h2 className="mb-3 text-sm font-semibold">コスト推移 (JPY)</h2>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => `\u00A5${v}`} />
                    <Tooltip {...tooltipStyle} formatter={(value: unknown) => [`\u00A5${Number(value).toLocaleString()}`, "コスト"]} labelFormatter={(l: unknown) => `日付: ${l}`} />
                    <defs>
                      <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="oklch(0.7 0.15 60)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="oklch(0.7 0.15 60)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="costJpy" stroke="oklch(0.7 0.15 60)" strokeWidth={2} fill="url(#costGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* モデル別割合（円グラフ） */}
            {modelData.length > 0 && (
              <div className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <h2 className="mb-3 text-sm font-semibold">モデル別トークン使用割合</h2>
                <div className="flex items-center">
                  <ResponsiveContainer width="50%" height={180}>
                    <PieChart>
                      <Pie data={modelData} dataKey="tokens" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                        {modelData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip {...tooltipStyle} formatter={(value: unknown) => [Number(value).toLocaleString(), "トークン"]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5">
                    {modelData.map((m, i) => (
                      <div key={m.name} className="flex items-center gap-2 text-[11px]">
                        <div className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="flex-1 truncate" style={{ color: "var(--muted-foreground)" }}>{m.name}</span>
                        <span className="font-medium">{((m.tokens / usage.totals.totalTokens) * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 日別/月別テーブル */}
          <div className="mb-5">
            <h2 className="mb-2 text-sm font-semibold">{period === "daily" ? "日別" : "月別"}利用量</h2>
            <div className="divide-y rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="grid grid-cols-5 gap-2 px-4 py-2.5 text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                <span>日付</span>
                <span className="text-right">リクエスト</span>
                <span className="text-right">トークン</span>
                <span className="text-right">USD</span>
                <span className="text-right">JPY</span>
              </div>
              {usage.data.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>データがありません</div>
              ) : (
                usage.data.map((entry) => (
                  <div key={entry.date} className="grid grid-cols-5 gap-2 px-4 py-2.5 text-sm">
                    <span className="font-medium">{entry.date}</span>
                    <span className="text-right" style={{ color: "var(--muted-foreground)" }}>{entry.requestCount}</span>
                    <span className="text-right" style={{ color: "var(--muted-foreground)" }}>{entry.totalTokens.toLocaleString()}</span>
                    <span className="text-right font-medium" style={{ color: "oklch(0.6 0.15 155)" }}>${entry.estimatedCost.toFixed(3)}</span>
                    <span className="text-right font-medium" style={{ color: "oklch(0.7 0.15 60)" }}>{`\u00A5${Math.round(entry.estimatedCost * USD_TO_JPY).toLocaleString()}`}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* モデル別詳細テーブル */}
          {modelData.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold">モデル別集計</h2>
              <div className="divide-y rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="grid grid-cols-4 gap-2 px-4 py-2.5 text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                  <span>モデル</span>
                  <span className="text-right">リクエスト</span>
                  <span className="text-right">トークン</span>
                  <span className="text-right">コスト</span>
                </div>
                {modelData.map((m) => (
                  <div key={m.name} className="grid grid-cols-4 gap-2 px-4 py-2.5 text-sm">
                    <span className="truncate font-medium">{m.name}</span>
                    <span className="text-right" style={{ color: "var(--muted-foreground)" }}>{m.requests}</span>
                    <span className="text-right" style={{ color: "var(--muted-foreground)" }}>{m.tokens.toLocaleString()}</span>
                    <span className="text-right font-medium" style={{ color: "oklch(0.6 0.15 155)" }}>${m.cost.toFixed(3)}</span>
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
