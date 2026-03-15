import { notFound } from "next/navigation";
import Link from "next/link";
import { getRedis } from "@/lib/db";
import { getActivitiesForDeal } from "@/lib/activity";
import { STAGE_LABELS, CONTACT_TYPE_LABELS } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DealStageSelector } from "@/components/deals/deal-stage-selector";
import { DealStatusActions } from "@/components/deals/deal-status-actions";
import { ShareDealButton } from "@/components/deals/share-deal-button";
import { TaskList } from "@/components/tasks/task-list";
import { AddTaskDialog } from "@/components/tasks/add-task-dialog";
import { ChecklistPanel } from "@/components/checklists/checklist-panel";
import { AdminOnly } from "@/components/layout/admin-only";
import { BuyBoxScorecard } from "@/components/deals/buy-box-scorecard";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Calendar,
  DollarSign,
  Users,
  Clock,
  CheckSquare,
  ListTodo,
} from "lucide-react";
import type { Deal, Contact, Task } from "@/lib/validations";
import type { ActivityEntry } from "@/lib/activity";
import type { ChecklistInstance } from "@/lib/checklist-templates";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

async function getDeal(id: string): Promise<Deal | null> {
  try {
    const redis = getRedis();
    return await redis.get<Deal>(`deal:${id}`);
  } catch {
    return null;
  }
}

async function getTasks(dealId: string): Promise<Task[]> {
  try {
    const redis = getRedis();
    const ids = await redis.zrange(`tasks:by_deal:${dealId}`, 0, -1);
    if (ids.length === 0) return [];
    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`task:${id}`);
    }
    const results = await pipeline.exec<(Task | null)[]>();
    return results.filter((r): r is Task => r !== null);
  } catch {
    return [];
  }
}

async function getChecklists(dealId: string): Promise<ChecklistInstance[]> {
  try {
    const redis = getRedis();
    const ids = await redis.zrange(`checklists:by_deal:${dealId}`, 0, -1);
    if (ids.length === 0) return [];
    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`checklist:${id}`);
    }
    const results = await pipeline.exec<(ChecklistInstance | null)[]>();
    return results.filter((r): r is ChecklistInstance => r !== null);
  } catch {
    return [];
  }
}

async function getContacts(ids: string[]): Promise<Contact[]> {
  if (ids.length === 0) return [];
  try {
    const redis = getRedis();
    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`contact:${id}`);
    }
    const results = await pipeline.exec<(Contact | null)[]>();
    return results.filter((r): r is Contact => r !== null);
  } catch {
    return [];
  }
}

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) notFound();

  const [contacts, activities, tasks, checklists] = await Promise.all([
    getContacts(deal.contact_ids || []),
    getActivitiesForDeal(id, 10),
    getTasks(id),
    getChecklists(id),
  ]);

  const pricePerUnit = deal.units > 0 ? deal.asking_price / deal.units : 0;
  const daysSinceCreated = Math.floor(
    (Date.now() - new Date(deal.created_at).getTime()) / 86400000
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/pipeline"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-blue-400 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Pipeline
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Building2 className="h-6 w-6 text-blue-500" />
              {deal.address}
            </h1>
            <p className="text-slate-400 mt-1">
              {deal.city}, {deal.state} {deal.zip || ""}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/deals/${id}/underwrite`}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
            >
              <DollarSign className="h-4 w-4" /> Underwrite
            </Link>
            <AdminOnly>
              <ShareDealButton dealId={id} />
            </AdminOnly>
            <AdminOnly>
              <DealStageSelector deal={deal} />
            </AdminOnly>
            <AdminOnly>
              <DealStatusActions deal={deal} />
            </AdminOnly>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-slate-500 mb-1">Asking Price</p>
            <p className="text-lg font-bold text-white">
              {formatCurrency(deal.asking_price)}
            </p>
          </CardContent>
        </Card>
        {deal.bid_price && (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-slate-500 mb-1">Bid Price</p>
              <p className="text-lg font-bold text-green-400">
                {formatCurrency(deal.bid_price)}
              </p>
            </CardContent>
          </Card>
        )}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-slate-500 mb-1">Units</p>
            <p className="text-lg font-bold text-white">{deal.units}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-slate-500 mb-1">Price / Unit</p>
            <p className="text-lg font-bold text-white">
              {formatCurrency(pricePerUnit)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-slate-500 mb-1">Days in Pipeline</p>
            <p className="text-lg font-bold text-white">{daysSinceCreated}</p>
          </CardContent>
        </Card>
      </div>

      {/* Buy Box Scorecard — screening tool */}
      {(deal.stage === "lead" || deal.stage === "screening" || deal.stage === "analysis") && (
        <BuyBoxScorecard deal={deal} />
      )}

      <div className="grid md:grid-cols-3 gap-6">
        {/* Property Details */}
        <Card className="bg-slate-900 border-slate-800 md:col-span-2">
          <CardHeader>
            <CardTitle className="text-white text-base">Property Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-500">Address</span>
                <p className="text-slate-200">
                  {deal.address}, {deal.city}, {deal.state} {deal.zip}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Source</span>
                <p className="text-slate-200">{deal.source}</p>
              </div>
              {deal.year_built && (
                <div>
                  <span className="text-slate-500">Year Built</span>
                  <p className="text-slate-200">{deal.year_built}</p>
                </div>
              )}
              {deal.property_type && (
                <div>
                  <span className="text-slate-500">Property Type</span>
                  <p className="text-slate-200">{deal.property_type}</p>
                </div>
              )}
              {deal.square_footage && (
                <div>
                  <span className="text-slate-500">Square Footage</span>
                  <p className="text-slate-200">
                    {deal.square_footage.toLocaleString()} SF
                  </p>
                </div>
              )}
              <div>
                <span className="text-slate-500">Created</span>
                <p className="text-slate-200">{formatDate(deal.created_at)}</p>
              </div>
            </div>

            {deal.market_notes && (
              <>
                <Separator className="bg-slate-800" />
                <div>
                  <span className="text-slate-500 text-sm">Market Notes</span>
                  <p className="text-slate-300 text-sm mt-1 whitespace-pre-wrap">
                    {deal.market_notes}
                  </p>
                </div>
              </>
            )}

            {/* LOI Details */}
            {deal.loi_amount && (
              <>
                <Separator className="bg-slate-800" />
                <h4 className="text-sm font-medium text-white">LOI Details</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-500">LOI Amount</span>
                    <p className="text-slate-200">
                      {formatCurrency(deal.loi_amount)}
                    </p>
                  </div>
                  {deal.loi_date && (
                    <div>
                      <span className="text-slate-500">LOI Date</span>
                      <p className="text-slate-200">{deal.loi_date}</p>
                    </div>
                  )}
                  {deal.earnest_money && (
                    <div>
                      <span className="text-slate-500">Earnest Money</span>
                      <p className="text-slate-200">
                        {formatCurrency(deal.earnest_money)}
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Sidebar: Contacts + Activity */}
        <div className="space-y-6">
          {/* Contacts */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Users className="h-4 w-4" /> Contacts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {contacts.length === 0 ? (
                <p className="text-sm text-slate-500">No contacts linked</p>
              ) : (
                <div className="space-y-3">
                  {contacts.map((c) => (
                    <div key={c.id} className="text-sm">
                      <p className="text-slate-200 font-medium">{c.name}</p>
                      <p className="text-slate-500">
                        {CONTACT_TYPE_LABELS[c.type]}
                        {c.company && ` — ${c.company}`}
                      </p>
                      {c.email && (
                        <p className="text-slate-400 text-xs">{c.email}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Clock className="h-4 w-4" /> Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activities.length === 0 ? (
                <p className="text-sm text-slate-500">No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {activities.map((a: ActivityEntry) => (
                    <div key={a.id} className="text-sm border-l-2 border-slate-800 pl-3">
                      <p className="text-slate-300">{a.action.replace(/_/g, " ")}</p>
                      <p className="text-slate-500 text-xs">
                        {timeAgo(a.timestamp)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tasks & Checklists */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Tasks */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <ListTodo className="h-4 w-4" /> Tasks
              </CardTitle>
              <AddTaskDialog dealId={id} />
            </div>
          </CardHeader>
          <CardContent>
            <TaskList tasks={tasks} />
          </CardContent>
        </Card>

        {/* Checklists */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <CheckSquare className="h-4 w-4 text-white" />
            <h3 className="text-base font-semibold text-white">Checklists</h3>
          </div>
          <ChecklistPanel dealId={id} checklists={checklists} />
        </div>
      </div>
    </div>
  );
}
