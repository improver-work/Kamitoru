import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAiUsage } from "../lib/tauri-api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, Line,
  PieChart, Pie, Cell,
} from "recharts";

const MODEL_COLORS = [
  "#6366f1", // indigo
  "#22c55e", // green
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#8b5cf6", // violet
  "#14b8a6", // teal
];

const USD_TO_JPY = 150;

/** 月の1日目〜今日までの日付配列を生成 */
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

/** 年の1月〜今月までの月配列を生成 */
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
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // 日別: 今月1日〜今日 / 月別: 今年1月〜今月
  const dateRange = useMemo(() => {
    if (period === "daily") {
      return {
        from: `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`,
        to: `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
      };
    }
    return {
      from: `${currentYear}-01-01`,
      to: `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    };
  }, [period, currentYear, currentMonth]);

  const { data: usage, isLoading } = useQuery({
    queryKey: ["ai-usage", period, dateRange.from, dateRange.to],
    queryFn: () => getAiUsage(period, dateRange.from, dateRange.to),
  });

  // 全日分のデータを生成（データがない日は0埋め）→ 日付昇順（左→右）
  const chartData = useMemo(() => {
    if (!usage) return [];
    const dataMap = new Map(usage.data.map((d) => [d.date, d]));

    const allDates = period === "daily"
      ? generateMonthDates(currentYear, currentMonth)
      : generateYearMonths(currentYear);

    let cumulativeCost = 0;
    return allDates.map((date) => {
      const entry = dataMap.get(date);
      const dailyCostJpy = Math.round((entry?.estimatedCost ?? 0) * USD_TO_JPY);
      cumulativeCost += dailyCostJpy;
      return {
        date,
        label: period === "daily" ? date.slice(8) : `${parseInt(date.slice(5))}月`,
        promptTokens: entry?.promptTokens ?? 0,
        completionTokens: entry?.completionTokens ?? 0,
        totalTokens: entry?.totalTokens ?? 0,
        costJpy: dailyCostJpy,
        costUsd: entry?.estimatedCost ?? 0,
        cumulativeCostJpy: cumulativeCost,
        requests: entry?.requestCount ?? 0,
      };
    });
  }, [usage, period, currentYear, currentMonth]);

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

  const totalTokens = usage?.totals.totalTokens ?? 0;

  const tt = {
    contentStyle: {
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: "8px", fontSize: "12px", color: "var(--foreground)",
      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    },
    labelStyle: { color: "var(--foreground)", fontWeight: 600, marginBottom: 4 },
  };

  const monthLabel = `${currentYear}年${currentMonth}月`;

  return (
    <div className="h-full overflow-auto p-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">AI利用状況</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            {period === "daily" ? monthLabel : `${currentYear}年`} のトークン使用量と概算コスト
          </p>
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
              { label: "リクエスト数", value: usage.totals.requestCount.toLocaleString(), sub: "回", color: "#6366f1" },
              { label: "トークン合計", value: usage.totals.totalTokens >= 1000 ? `${(usage.totals.totalTokens / 1000).toFixed(1)}k` : String(usage.totals.totalTokens), sub: "tokens", color: "var(--foreground)" },
              { label: "概算コスト", value: `$${usage.totals.estimatedCost.toFixed(3)}`, sub: "USD", color: "#22c55e" },
              { label: "概算コスト", value: `\u00A5${Math.round(usage.totals.estimatedCost * USD_TO_JPY).toLocaleString()}`, sub: "JPY", color: "#f59e0b" },
            ].map(({ label, value, sub, color }) => (
              <div key={label + sub} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-[11px] font-medium tracking-wider" style={{ color: "var(--muted-foreground)" }}>{label}</p>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold" style={{ color }}>{value}</span>
                  <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{sub}</span>
                </div>
              </div>
            ))}
          </div>

          {/* トークン使用量 棒グラフ（全日表示） */}
          <div className="mb-4 rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h2 className="mb-1 text-sm font-semibold">トークン使用量</h2>
            <p className="mb-3 text-[11px]" style={{ color: "var(--muted-foreground)" }}>入力 / 出力トークンの{period === "daily" ? "日別" : "月別"}推移</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval={period === "daily" ? 1 : 0} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} width={45} />
                <Tooltip {...tt}
                  formatter={(value: unknown, name: unknown) => [Number(value).toLocaleString(), name === "promptTokens" ? "入力トークン" : "出力トークン"]}
                  labelFormatter={(_: unknown, payload: readonly unknown[]) => { const p = (payload as ReadonlyArray<{payload?: {date?: string}}>)[0]; return p?.payload?.date ?? ""; }} />
                <Legend formatter={(value: unknown) => value === "promptTokens" ? "入力" : "出力"} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                <Bar dataKey="promptTokens" stackId="t" fill="#6366f1" radius={[0, 0, 0, 0]} maxBarSize={20} />
                <Bar dataKey="completionTokens" stackId="t" fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* コスト推移: 日別(棒) + 累積(線) */}
          <div className="mb-4 rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h2 className="mb-1 text-sm font-semibold">コスト推移</h2>
            <p className="mb-3 text-[11px]" style={{ color: "var(--muted-foreground)" }}>{period === "daily" ? "日別" : "月別"}コスト（棒）と累積コスト（線） / JPY</p>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval={period === "daily" ? 1 : 0} />
                <YAxis yAxisId="daily" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => `${v}`} width={45} />
                <YAxis yAxisId="cumulative" orientation="right" tick={{ fontSize: 10, fill: "#f59e0b" }} tickFormatter={(v: number) => `${v}`} width={50} />
                <Tooltip {...tt}
                  formatter={(value: unknown, name: unknown) => {
                    const v = Number(value);
                    if (name === "costJpy") return [`\u00A5${v.toLocaleString()}`, `${period === "daily" ? "日別" : "月別"}コスト`];
                    return [`\u00A5${v.toLocaleString()}`, "累積コスト"];
                  }}
                  labelFormatter={(_: unknown, payload: readonly unknown[]) => { const p = (payload as ReadonlyArray<{payload?: {date?: string}}>)[0]; return p?.payload?.date ?? ""; }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                  formatter={(value: unknown) => value === "costJpy" ? `${period === "daily" ? "日別" : "月別"}コスト` : "累積コスト"} />
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <Bar yAxisId="daily" dataKey="costJpy" fill="url(#barGrad)" radius={[2, 2, 0, 0]} maxBarSize={18} />
                <Line yAxisId="cumulative" type="monotone" dataKey="cumulativeCostJpy" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* モデル別: ドーナツ + テーブル */}
          {modelData.length > 0 && (
            <div className="mb-4 rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h2 className="mb-1 text-sm font-semibold">モデル別利用状況</h2>
              <p className="mb-3 text-[11px]" style={{ color: "var(--muted-foreground)" }}>期間内のモデルごとのトークン使用量とコスト</p>
              <div className="flex items-start gap-4">
                {/* ドーナツチャート */}
                <div className="w-48 shrink-0">
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={modelData} dataKey="tokens" nameKey="name" cx="50%" cy="50%" outerRadius={65} innerRadius={38} strokeWidth={0}>
                        {modelData.map((_, i) => (
                          <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip {...tt} formatter={(value: unknown) => [Number(value).toLocaleString(), "tokens"]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* テーブル */}
                <div className="flex-1 divide-y rounded-lg border" style={{ borderColor: "var(--border)" }}>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-2 text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                    <span>モデル</span>
                    <span className="text-right">リクエスト</span>
                    <span className="text-right">トークン</span>
                    <span className="text-right">コスト</span>
                  </div>
                  {modelData.map((m, i) => (
                    <div key={m.name} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-2 text-[12px]">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                        <span className="truncate font-medium">{m.name}</span>
                        {totalTokens > 0 && <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{((m.tokens / totalTokens) * 100).toFixed(0)}%</span>}
                      </div>
                      <span className="text-right tabular-nums" style={{ color: "var(--muted-foreground)" }}>{m.requests}</span>
                      <span className="text-right tabular-nums" style={{ color: "var(--muted-foreground)" }}>{m.tokens.toLocaleString()}</span>
                      <span className="text-right tabular-nums font-medium" style={{ color: "#22c55e" }}>${m.cost.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 日別/月別テーブル */}
          <div>
            <h2 className="mb-2 text-sm font-semibold">{period === "daily" ? "日別" : "月別"}明細</h2>
            <div className="divide-y rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="grid grid-cols-6 gap-2 px-4 py-2 text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                <span>日付</span>
                <span className="text-right">リクエスト</span>
                <span className="text-right">入力</span>
                <span className="text-right">出力</span>
                <span className="text-right">USD</span>
                <span className="text-right">JPY</span>
              </div>
              {usage.data.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>データがありません</div>
              ) : (
                [...usage.data].reverse().map((entry) => (
                  <div key={entry.date} className="grid grid-cols-6 gap-2 px-4 py-2 text-[12px]">
                    <span className="font-medium tabular-nums">{entry.date}</span>
                    <span className="text-right tabular-nums" style={{ color: "var(--muted-foreground)" }}>{entry.requestCount}</span>
                    <span className="text-right tabular-nums" style={{ color: "var(--muted-foreground)" }}>{entry.promptTokens.toLocaleString()}</span>
                    <span className="text-right tabular-nums" style={{ color: "var(--muted-foreground)" }}>{entry.completionTokens.toLocaleString()}</span>
                    <span className="text-right tabular-nums font-medium" style={{ color: "#22c55e" }}>${entry.estimatedCost.toFixed(3)}</span>
                    <span className="text-right tabular-nums font-medium" style={{ color: "#f59e0b" }}>{`\u00A5${Math.round(entry.estimatedCost * USD_TO_JPY).toLocaleString()}`}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
