import { notFound } from "next/navigation";
import Link from "next/link";
import { getRedis } from "@/lib/db";
import { getActivitiesForDeal } from "@/lib/activity";
import { CONTACT_TYPE_LABELS } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DealStageSelector } from "@/components/deals/deal-stage-selector";
import { DealStatusActions } from "@/components/deals/deal-status-actions";
import { ShareDealButton } from "@/components/deals/share-deal-button";
import { TaskList } from "@/components/tasks/task-list";
import { AddTaskDialog } from "@/components/tasks/add-task-dialog";
import { ChecklistPanel } from "@/components/checklists/checklist-panel";
import { AdminOnly } from "@/components/layout/admin-only";
import { BuyBoxScorecard } from "@/components/deals/buy-box-scorecard";
import { EditablePropertyDetails } from "@/components/deals/editable-property-details";
import { EditableMetrics } from "@/components/deals/editable-metrics";
import { RentRollTable } from "@/components/deals/rent-roll-table";
import { T12StatementPanel } from "@/components/deals/t12-statement";
import { NeighborhoodLinks } from "@/components/deals/neighborhood-links";
import { getContactDisplayName } from "@/lib/contact-utils";
import {
  ArrowLeft,
  Building2,
  DollarSign,
  Users,
  Clock,
  CheckSquare,
  ListTodo,
  MapPin,
} from "lucide-react";
import type { Deal, Contact, Task } from "@/lib/validations";
import type { ActivityEntry } from "@/lib/activity";
import type { ChecklistInstance } from "@/lib/checklist-templates";

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

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${deal.address}, ${deal.city}, ${deal.state} ${deal.zip || ""}`
  )}`;

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
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-400 transition-colors"
                title="View on Google Maps"
              >
                {deal.address}
              </a>
            </h1>
            <p className="text-slate-400 mt-1 flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-400"
              >
                {deal.city}, {deal.state} {deal.zip || ""}
              </a>
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

      {/* Editable Key Metrics */}
      <EditableMetrics deal={deal} />

      {/* Buy Box Scorecard — screening tool */}
      {(deal.stage === "lead" || deal.stage === "screening" || deal.stage === "analysis") && (
        <BuyBoxScorecard deal={deal} />
      )}

      <div className="grid md:grid-cols-3 gap-6">
        {/* Editable Property Details */}
        <EditablePropertyDetails deal={deal} />

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
                      <p className="text-slate-200 font-medium">{getContactDisplayName(c)}</p>
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

          {/* Neighborhood Links */}
          <NeighborhoodLinks deal={deal} />

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

      {/* Rent Roll */}
      <RentRollTable dealId={id} rentRoll={deal.rent_roll || []} />

      {/* T12 Operating Statement */}
      <T12StatementPanel dealId={id} t12={deal.t12} />

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
