import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAiUsage } from "../lib/tauri-api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, Line,
  PieChart, Pie, Cell,
} from "recharts";

const MODEL_COLORS: Record<string, string> = {
  "gpt-4o-mini": "#6366f1",
  "gpt-4o": "#8b5cf6",
  "gpt-5.4-mini": "#6366f1",
  "gpt-5.4-nano": "#a78bfa",
  "gemini-3-flash-preview": "#22c55e",
  "gemini-3.1-pro-preview": "#16a34a",
  "gemini-2.5-pro": "#15803d",
  "gemini-2.5-flash": "#4ade80",
};
const FALLBACK_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4", "#f97316", "#8b5cf6", "#14b8a6"];
function getModelColor(model: string, index: number): string {
  return MODEL_COLORS[model] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

const USD_TO_JPY = 150;

type ChartMetric = "tokens" | "cost" | "requests";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** 月の1日目〜今日(or月末)までの日付配列 */
function generateMonthDates(year: number, month: number): string[] {
  const today = new Date();
  const lastDay = (year === today.getFullYear() && month === today.getMonth() + 1)
    ? today.getDate()
    : new Date(year, month, 0).getDate();
  const dates: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    dates.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return dates;
}

function generateYearMonths(year: number): string[] {
  const today = new Date();
  const lastMonth = year === today.getFullYear() ? today.getMonth() + 1 : 12;
  const months: string[] = [];
  for (let m = 1; m <= lastMonth; m++) {
    months.push(`${year}-${String(m).padStart(2, "0")}`);
  }
  return months;
}

export function UsagePage() {
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedModel, setSelectedModel] = useState("all");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("tokens");

  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth() + 1;
  const isCurrentMonth = monthOffset === 0;

  const dateRange = useMemo(() => {
    if (period === "daily") {
      const lastDay = isCurrentMonth ? now.getDate() : new Date(targetYear, targetMonth, 0).getDate();
      return {
        from: `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`,
        to: `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      };
    }
    return {
      from: `${targetYear}-01-01`,
      to: `${targetYear}-12-31`,
    };
  }, [period, targetYear, targetMonth, isCurrentMonth]);

  const { data: usage, isLoading } = useQuery({
    queryKey: ["ai-usage", period, dateRange.from, dateRange.to],
    queryFn: () => getAiUsage(period, dateRange.from, dateRange.to),
  });

  // 利用可能なモデル一覧
  const availableModels = useMemo(() => {
    if (!usage?.data) return [];
    const set = new Set<string>();
    for (const d of usage.data) {
      for (const m of Object.keys(d.byModel)) set.add(m);
    }
    return Array.from(set).sort();
  }, [usage]);

  // モデルフィルタ適用済みの集計
  const filteredTotals = useMemo(() => {
    if (!usage?.data) return { totalTokens: 0, promptTokens: 0, completionTokens: 0, estimatedCost: 0, requestCount: 0 };
    if (selectedModel === "all") return usage.totals;
    let tokens = 0, cost = 0, requests = 0;
    for (const d of usage.data) {
      const m = d.byModel[selectedModel];
      if (m) { tokens += m.tokens; cost += m.cost; requests += m.requests; }
    }
    return { totalTokens: tokens, promptTokens: 0, completionTokens: 0, estimatedCost: cost, requestCount: requests };
  }, [usage, selectedModel]);

  // チャート用データ（全日分、モデルフィルタ適用）
  const chartData = useMemo(() => {
    if (!usage) return [];
    const dataMap = new Map(usage.data.map((d) => [d.date, d]));
    const allDates = period === "daily"
      ? generateMonthDates(targetYear, targetMonth)
      : generateYearMonths(targetYear);

    let cumulativeCost = 0;
    return allDates.map((date) => {
      const entry = dataMap.get(date);
      let tokens = 0, cost = 0, reqs = 0, prompt = 0, completion = 0;
      if (entry) {
        if (selectedModel === "all") {
          tokens = entry.totalTokens; cost = entry.estimatedCost;
          reqs = entry.requestCount; prompt = entry.promptTokens; completion = entry.completionTokens;
        } else {
          const m = entry.byModel[selectedModel];
          if (m) { tokens = m.tokens; cost = m.cost; reqs = m.requests; }
        }
      }
      const costJpy = Math.round(cost * USD_TO_JPY);
      cumulativeCost += costJpy;
      return {
        date, label: period === "daily" ? date.slice(8) : `${parseInt(date.slice(5))}月`,
        tokens, promptTokens: prompt, completionTokens: completion,
        costJpy, costUsd: cost, cumulativeCostJpy: cumulativeCost, requests: reqs,
      };
    });
  }, [usage, period, targetYear, targetMonth, selectedModel]);

  // モデル別集計
  const modelData = useMemo(() => {
    if (!usage?.data) return [];
    const map = new Map<string, { tokens: number; cost: number; requests: number }>();
    for (const day of usage.data) {
      for (const [model, info] of Object.entries(day.byModel)) {
        const existing = map.get(model) ?? { tokens: 0, cost: 0, requests: 0 };
        existing.tokens += info.tokens; existing.cost += info.cost; existing.requests += info.requests;
        map.set(model, existing);
      }
    }
    return Array.from(map.entries()).map(([name, info]) => ({ name, ...info })).sort((a, b) => b.tokens - a.tokens);
  }, [usage]);

  const totalTokens = filteredTotals.totalTokens;
  const tt = {
    contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px", color: "var(--foreground)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" },
    labelStyle: { color: "var(--foreground)", fontWeight: 600, marginBottom: 4 },
  };

  const monthLabel = period === "daily" ? `${targetYear}年${targetMonth}月` : `${targetYear}年`;
  const metricLabel = chartMetric === "tokens" ? "トークン" : chartMetric === "cost" ? "コスト (JPY)" : "リクエスト数";

  return (
    <div className="h-full overflow-auto p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">AI利用状況</h1>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--muted-foreground)" }}>{monthLabel} {selectedModel !== "all" && `/ ${selectedModel}`}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* モデル選択 */}
          <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}
            className="h-7 rounded-md border px-2 text-xs"
            style={{ background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
            <option value="all">全モデル</option>
            {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {/* 期間切替 */}
          <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: "var(--secondary)" }}>
            {(["daily", "monthly"] as const).map((p) => (
              <button key={p} onClick={() => { setPeriod(p); setMonthOffset(0); }}
                className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={{ background: period === p ? "var(--background)" : "transparent", color: period === p ? "var(--foreground)" : "var(--muted-foreground)" }}>
                {p === "daily" ? "日別" : "月別"}
              </button>
            ))}
          </div>
          {/* 月ナビ */}
          {period === "daily" && (
            <div className="flex items-center gap-1">
              <button onClick={() => setMonthOffset((p) => p - 1)} className="rounded p-1 transition hover:opacity-70"
                style={{ color: "var(--muted-foreground)" }}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <span className="min-w-[80px] text-center text-xs font-medium">{targetMonth}月</span>
              <button onClick={() => setMonthOffset((p) => p + 1)} disabled={isCurrentMonth}
                className="rounded p-1 transition hover:opacity-70 disabled:opacity-30"
                style={{ color: "var(--muted-foreground)" }}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </div>
      ) : usage ? (
        <>
          {/* サマリーカード */}
          <div className="mb-4 grid grid-cols-3 gap-3">
            {[
              { label: "トークン", value: formatTokens(filteredTotals.totalTokens), sub: `${filteredTotals.totalTokens.toLocaleString()} tokens`, color: "#6366f1", metric: "tokens" as ChartMetric },
              { label: "概算コスト", value: `\u00A5${Math.round(filteredTotals.estimatedCost * USD_TO_JPY).toLocaleString()}`, sub: `$${filteredTotals.estimatedCost.toFixed(3)} USD`, color: "#22c55e", metric: "cost" as ChartMetric },
              { label: "リクエスト", value: `${filteredTotals.requestCount}`, sub: "回", color: "#f59e0b", metric: "requests" as ChartMetric },
            ].map(({ label, value, sub, color, metric }) => (
              <button key={label} onClick={() => setChartMetric(metric)}
                className="rounded-xl border p-4 text-left transition-all"
                style={{ background: "var(--card)", borderColor: chartMetric === metric ? color : "var(--border)", boxShadow: chartMetric === metric ? `0 0 0 1px ${color}40` : "none" }}>
                <p className="text-[11px] font-medium tracking-wider" style={{ color: "var(--muted-foreground)" }}>{label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
                <p className="mt-0.5 text-[10px] tabular-nums" style={{ color: "var(--muted-foreground)" }}>{sub}</p>
              </button>
            ))}
          </div>

          {/* メインチャート: メトリクス別 */}
          <div className="mb-4 rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{metricLabel}の推移</h2>
              <div className="flex gap-0.5 rounded-lg p-0.5" style={{ background: "var(--secondary)" }}>
                {([["tokens", "トークン"], ["cost", "コスト"], ["requests", "リクエスト"]] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setChartMetric(key as ChartMetric)}
                    className="rounded-md px-2 py-1 text-[10px] font-medium transition-colors"
                    style={{ background: chartMetric === key ? "var(--background)" : "transparent", color: chartMetric === key ? "var(--foreground)" : "var(--muted-foreground)" }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              {chartMetric === "tokens" ? (
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval={period === "daily" ? 1 : 0} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => formatTokens(v)} width={45} />
                  <Tooltip {...tt} formatter={(v: unknown, n: unknown) => [Number(v).toLocaleString(), n === "promptTokens" ? "入力" : n === "completionTokens" ? "出力" : "トークン"]}
                    labelFormatter={(_: unknown, p: readonly unknown[]) => { const e = (p as ReadonlyArray<{payload?: {date?: string}}>)[0]; return e?.payload?.date ?? ""; }} />
                  {selectedModel === "all" ? (
                    <>
                      <Legend formatter={(v: unknown) => v === "promptTokens" ? "入力" : "出力"} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="promptTokens" stackId="t" fill="#6366f1" maxBarSize={18} />
                      <Bar dataKey="completionTokens" stackId="t" fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={18} />
                    </>
                  ) : (
                    <Bar dataKey="tokens" fill={getModelColor(selectedModel, 0)} radius={[2, 2, 0, 0]} maxBarSize={18} />
                  )}
                </BarChart>
              ) : chartMetric === "cost" ? (
                <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval={period === "daily" ? 1 : 0} />
                  <YAxis yAxisId="d" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={45} />
                  <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 10, fill: "#f59e0b" }} width={50} />
                  <Tooltip {...tt} formatter={(v: unknown, n: unknown) => [`\u00A5${Number(v).toLocaleString()}`, n === "costJpy" ? "日別" : "累積"]}
                    labelFormatter={(_: unknown, p: readonly unknown[]) => { const e = (p as ReadonlyArray<{payload?: {date?: string}}>)[0]; return e?.payload?.date ?? ""; }} />
                  <Legend formatter={(v: unknown) => v === "costJpy" ? "日別コスト" : "累積コスト"} wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="d" dataKey="costJpy" fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={18} opacity={0.8} />
                  <Line yAxisId="c" type="monotone" dataKey="cumulativeCostJpy" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                </ComposedChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval={period === "daily" ? 1 : 0} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={45} />
                  <Tooltip {...tt} formatter={(v: unknown) => [`${Number(v)}回`, "リクエスト"]}
                    labelFormatter={(_: unknown, p: readonly unknown[]) => { const e = (p as ReadonlyArray<{payload?: {date?: string}}>)[0]; return e?.payload?.date ?? ""; }} />
                  <Bar dataKey="requests" fill="#f59e0b" radius={[2, 2, 0, 0]} maxBarSize={18} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* モデル別: ドーナツ + テーブル */}
          {modelData.length > 0 && selectedModel === "all" && (
            <div className="mb-4 rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h2 className="mb-3 text-sm font-semibold">モデル別内訳</h2>
              <div className="flex items-start gap-4">
                <div className="w-44 shrink-0">
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={modelData} dataKey="tokens" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={35} strokeWidth={0}>
                        {modelData.map((m, i) => <Cell key={i} fill={getModelColor(m.name, i)} />)}
                      </Pie>
                      <Tooltip {...tt} formatter={(v: unknown) => [Number(v).toLocaleString(), "tokens"]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 divide-y rounded-lg border" style={{ borderColor: "var(--border)" }}>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-1.5 text-[10px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                    <span>モデル</span><span className="text-right">リクエスト</span><span className="text-right">トークン</span><span className="text-right">コスト</span>
                  </div>
                  {modelData.map((m, i) => (
                    <button key={m.name} onClick={() => setSelectedModel(m.name)}
                      className="grid w-full grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-1.5 text-[11px] text-left transition hover:opacity-80">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 shrink-0 rounded-sm" style={{ background: getModelColor(m.name, i) }} />
                        <span className="truncate font-medium">{m.name}</span>
                        {totalTokens > 0 && <span className="text-[9px]" style={{ color: "var(--muted-foreground)" }}>{((m.tokens / totalTokens) * 100).toFixed(0)}%</span>}
                      </div>
                      <span className="text-right tabular-nums" style={{ color: "var(--muted-foreground)" }}>{m.requests}</span>
                      <span className="text-right tabular-nums" style={{ color: "var(--muted-foreground)" }}>{formatTokens(m.tokens)}</span>
                      <span className="text-right tabular-nums font-medium" style={{ color: "#22c55e" }}>{`\u00A5${Math.round(m.cost * USD_TO_JPY).toLocaleString()}`}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 明細テーブル */}
          <div>
            <h2 className="mb-2 text-sm font-semibold">{period === "daily" ? "日別" : "月別"}明細</h2>
            <div className="divide-y rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="grid grid-cols-5 gap-2 px-4 py-1.5 text-[10px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                <span>日付</span><span className="text-right">リクエスト</span><span className="text-right">トークン</span><span className="text-right">USD</span><span className="text-right">JPY</span>
              </div>
              {usage.data.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>データがありません</div>
              ) : (
                [...usage.data].reverse().map((entry) => {
                  const tokens = selectedModel === "all" ? entry.totalTokens : (entry.byModel[selectedModel]?.tokens ?? 0);
                  const cost = selectedModel === "all" ? entry.estimatedCost : (entry.byModel[selectedModel]?.cost ?? 0);
                  const reqs = selectedModel === "all" ? entry.requestCount : (entry.byModel[selectedModel]?.requests ?? 0);
                  if (selectedModel !== "all" && tokens === 0) return null;
                  return (
                    <div key={entry.date} className="grid grid-cols-5 gap-2 px-4 py-1.5 text-[11px]">
                      <span className="font-medium tabular-nums">{entry.date}</span>
                      <span className="text-right tabular-nums" style={{ color: "var(--muted-foreground)" }}>{reqs}</span>
                      <span className="text-right tabular-nums" style={{ color: "var(--muted-foreground)" }}>{tokens.toLocaleString()}</span>
                      <span className="text-right tabular-nums font-medium" style={{ color: "#22c55e" }}>${cost.toFixed(3)}</span>
                      <span className="text-right tabular-nums font-medium" style={{ color: "#f59e0b" }}>{`\u00A5${Math.round(cost * USD_TO_JPY).toLocaleString()}`}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
