import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { getRecentActivities } from "@/lib/activity";
import {
  DEAL_STAGES,
  STAGE_LABELS,
  STAGE_STALE_DAYS,
  type DealStage,
} from "@/lib/constants";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Building2, AlertTriangle, CheckSquare, TrendingUp, Clock } from "lucide-react";
import { PipelineChart } from "@/components/dashboard/pipeline-chart";
import { AttentionWidget, type AttentionItem } from "@/components/dashboard/attention-widget";
import type { Deal, Task } from "@/lib/validations";
import type { ActivityEntry } from "@/lib/activity";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) return null;

  const redis = getRedis();
  const now = Date.now();
  const today = new Date().toISOString().split("T")[0];

  // Fetch all active deals across stages
  const stageData: { name: string; count: number; value: number }[] = [];
  const allDeals: Deal[] = [];
  const attentionItems: AttentionItem[] = [];

  for (const stage of DEAL_STAGES) {
    const ids = await redis.zrange(`deals:by_stage:${stage}`, 0, -1);
    let deals: Deal[] = [];
    if (ids.length > 0) {
      const pipeline = redis.pipeline();
      for (const id of ids) {
        pipeline.get(`deal:${id}`);
      }
      const results = await pipeline.exec<(Deal | null)[]>();
      deals = results.filter((d): d is Deal => d !== null && d.status === "active");
    }

    const totalValue = deals.reduce((sum, d) => sum + d.asking_price, 0);
    stageData.push({
      name: STAGE_LABELS[stage],
      count: deals.length,
      value: totalValue,
    });
    allDeals.push(...deals);

    // Check for stale deals
    const staleDays = STAGE_STALE_DAYS[stage];
    const staleThreshold = now - staleDays * 86400000;
    for (const deal of deals) {
      const lastActivity = new Date(deal.last_activity_at || deal.updated_at).getTime();
      if (lastActivity < staleThreshold) {
        const daysStale = Math.floor((now - lastActivity) / 86400000);
        attentionItems.push({
          type: "stale_deal",
          label: deal.address,
          detail: `${STAGE_LABELS[deal.stage]} · ${daysStale}d without activity`,
          href: `/deals/${deal.id}`,
        });
      }

      // DD expiring
      if (deal.stage === "due_diligence" && deal.dd_end_date) {
        const daysUntilExpiry = Math.floor(
          (new Date(deal.dd_end_date).getTime() - now) / 86400000
        );
        if (daysUntilExpiry >= 0 && daysUntilExpiry <= 14) {
          attentionItems.push({
            type: "dd_expiring",
            label: deal.address,
            detail: `DD expires in ${daysUntilExpiry}d`,
            href: `/deals/${deal.id}`,
          });
        }
      }

      // Closing soon
      if (deal.stage === "closing" && deal.closing_date) {
        const daysUntilClose = Math.floor(
          (new Date(deal.closing_date).getTime() - now) / 86400000
        );
        if (daysUntilClose >= 0 && daysUntilClose <= 30) {
          attentionItems.push({
            type: "closing_soon",
            label: deal.address,
            detail: `Closing in ${daysUntilClose}d`,
            href: `/deals/${deal.id}`,
          });
        }
      }
    }
  }

  // Fetch overdue tasks
  const taskIds = await redis.zrange("tasks:all", 0, -1);
  let overdueTasks = 0;
  if (taskIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of taskIds) {
      pipeline.get(`task:${id}`);
    }
    const tasks = await pipeline.exec<(Task | null)[]>();
    for (const task of tasks) {
      if (!task || task.completed) continue;
      if (task.due_date < today) {
        overdueTasks++;
        const daysOverdue = Math.floor(
          (now - new Date(task.due_date).getTime()) / 86400000
        );
        attentionItems.push({
          type: "overdue_task",
          label: task.title,
          detail: `${daysOverdue}d overdue`,
          href: `/deals/${task.deal_id}`,
        });
      }
    }
  }

  // Sort attention items: overdue tasks first, then stale, then expiring
  const typePriority = { overdue_task: 0, dd_expiring: 1, closing_soon: 2, stale_deal: 3 };
  attentionItems.sort((a, b) => typePriority[a.type] - typePriority[b.type]);

  // Fetch recent activity
  const activities = await getRecentActivities(10);

  // Build deal name map for activity feed
  const dealNameMap: Record<string, string> = {};
  for (const deal of allDeals) {
    dealNameMap[deal.id] = deal.address;
  }

  // KPIs
  const activeDeals = allDeals.length;
  const pipelineValue = allDeals.reduce((sum, d) => sum + d.asking_price, 0);
  const staleDeals = attentionItems.filter((i) => i.type === "stale_deal").length;

  // Closed this quarter
  const quarterStart = new Date();
  quarterStart.setMonth(Math.floor(quarterStart.getMonth() / 3) * 3, 1);
  quarterStart.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">
          Pipeline overview and action items
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-slate-400">
              <Building2 className="h-4 w-4" />
              Active Deals
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{activeDeals}</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-slate-400">
              <TrendingUp className="h-4 w-4" />
              Pipeline Value
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {formatCurrency(pipelineValue)}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-slate-400">
              <AlertTriangle className="h-4 w-4" />
              Overdue Tasks
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-bold ${
                overdueTasks > 0 ? "text-red-400" : "text-white"
              }`}
            >
              {overdueTasks}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-slate-400">
              <CheckSquare className="h-4 w-4" />
              Stale Deals
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-bold ${
                staleDeals > 0 ? "text-yellow-400" : "text-white"
              }`}
            >
              {staleDeals}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main content area */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Pipeline Summary</CardTitle>
            <CardDescription className="text-slate-400">
              Deals by stage
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PipelineChart data={stageData} />
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Needs Attention</CardTitle>
            <CardDescription className="text-slate-400">
              {attentionItems.length > 0
                ? `${attentionItems.length} item${attentionItems.length !== 1 ? "s" : ""}`
                : "All clear"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AttentionWidget items={attentionItems} />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Clock className="h-4 w-4" /> Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-slate-500 text-sm">
              No recent activity
            </div>
          ) : (
            <div className="space-y-3">
              {activities.map((a: ActivityEntry) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-4 text-sm border-l-2 border-slate-800 pl-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-300">
                      {a.action.replace(/_/g, " ")}
                    </p>
                    {dealNameMap[a.deal_id] && (
                      <p className="text-xs text-slate-500 truncate">
                        {dealNameMap[a.deal_id]}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-slate-600 whitespace-nowrap">
                    {timeAgo(a.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
