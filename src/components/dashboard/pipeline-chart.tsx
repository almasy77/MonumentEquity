"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const STAGE_COLORS: Record<string, string> = {
  Lead: "#64748b",
  Screening: "#6366f1",
  Analysis: "#3b82f6",
  LOI: "#8b5cf6",
  "Due Diligence": "#f59e0b",
  Closing: "#f97316",
  Onboarding: "#22c55e",
  Stabilized: "#10b981",
};

export function PipelineChart({
  data,
}: {
  data: { name: string; count: number; value: number }[];
}) {
  if (data.every((d) => d.count === 0)) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
        Add your first deal to see the pipeline chart
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <XAxis
          dataKey="name"
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          axisLine={{ stroke: "#334155" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1e293b",
            border: "1px solid #334155",
            borderRadius: "8px",
            color: "#f8fafc",
            fontSize: 12,
          }}
          formatter={(value) => [String(value), "Deals"]}
          labelFormatter={(label) => String(label)}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={STAGE_COLORS[entry.name] || "#3b82f6"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
