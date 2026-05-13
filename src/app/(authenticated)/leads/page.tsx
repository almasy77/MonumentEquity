import Link from "next/link";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Inbox, Mail } from "lucide-react";
import type { PendingListing } from "@/lib/validations";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmtPrice(n?: number): string {
  if (!n) return "—";
  return currencyFmt.format(n);
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default async function LeadsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const redis = getRedis();
  const ids = await redis.zrange("pending_listings:queue", 0, -1, { rev: true });

  let pending: PendingListing[] = [];
  if (ids.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`pending_listing:${id}`);
    }
    const results = await pipeline.exec<(PendingListing | null)[]>();
    pending = results.filter((p): p is PendingListing => p !== null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Lead Review</h1>
          <p className="text-slate-400 text-sm mt-1">
            {pending.length === 0
              ? "No listings awaiting review"
              : `${pending.length} listing${pending.length === 1 ? "" : "s"} awaiting review`}
          </p>
        </div>
      </div>

      {pending.length === 0 ? (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-8">
            <div className="flex flex-col items-center justify-center text-center">
              <Inbox className="h-12 w-12 text-slate-600 mb-3" />
              <h3 className="text-lg font-medium text-slate-300">Inbox empty</h3>
              <p className="text-slate-500 text-sm mt-1 max-w-md">
                Forward listing emails from Crexi, LoopNet, or brokers to your inbound address.
                Parsed listings will appear here for review before becoming deals.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {pending.map((p) => {
            const e = p.extracted;
            return (
              <Link
                key={p.id}
                href={`/leads/${p.id}`}
                className="block bg-slate-900 border border-slate-800 rounded-lg p-4 hover:bg-slate-800/60 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{p.from_name || p.from}</span>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0">{timeAgo(p.received_at)}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-300 truncate">{p.subject}</div>
                    <div className="mt-2 text-base font-medium text-white truncate">
                      {e.address || "(address not extracted)"}
                      {e.city && e.state ? `, ${e.city}, ${e.state}` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
                      <span>{e.units ? `${e.units} units` : "— units"}</span>
                      <span>{fmtPrice(e.asking_price)}</span>
                      {e.year_built && <span>Built {e.year_built}</span>}
                      {e.property_type && <span>{e.property_type}</span>}
                    </div>
                  </div>
                  {e.photo_url && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={e.photo_url}
                      alt=""
                      className="h-16 w-24 object-cover rounded shrink-0 bg-slate-800"
                    />
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
