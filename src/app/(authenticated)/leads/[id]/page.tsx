import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { ChevronLeft } from "lucide-react";
import { LeadReviewActions } from "@/components/leads/lead-review-actions";
import type { PendingListing } from "@/lib/validations";

interface InboundEmailRecord {
  id: string;
  from: string;
  from_name?: string;
  subject: string;
  text_body: string;
  html_body?: string;
  received_at: string;
  status?: string;
  attachments?: Array<{ name: string; content_type: string; content_length: number }>;
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;

  const { id } = await params;
  const redis = getRedis();

  const pending = await redis.get<PendingListing>(`pending_listing:${id}`);
  if (!pending) notFound();

  const email = await redis.get<InboundEmailRecord>(`inbound_email:${pending.source_email_id}`);

  return (
    <div className="space-y-4">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ChevronLeft className="h-4 w-4" /> Back to Leads
      </Link>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white truncate">
            {pending.extracted.address || pending.subject}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            From {pending.from_name || pending.from} · {new Date(pending.received_at).toLocaleString()}
          </p>
        </div>
        {pending.status === "pending" ? (
          <LeadReviewActions pendingId={pending.id} />
        ) : (
          <span className="text-xs text-slate-500 uppercase tracking-wider">
            {pending.status}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Extracted fields */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
            Extracted by AI
          </h2>
          <dl className="space-y-2.5 text-sm">
            <Row label="Address" value={pending.extracted.address} />
            <Row label="City" value={pending.extracted.city} />
            <Row label="State" value={pending.extracted.state} />
            <Row label="Zip" value={pending.extracted.zip} />
            <Row label="Units" value={pending.extracted.units?.toString()} />
            <Row
              label="Asking Price"
              value={
                pending.extracted.asking_price
                  ? `$${pending.extracted.asking_price.toLocaleString()}`
                  : undefined
              }
            />
            <Row label="Year Built" value={pending.extracted.year_built?.toString()} />
            <Row label="Property Type" value={pending.extracted.property_type} />
            <Row
              label="Square Footage"
              value={pending.extracted.square_footage?.toLocaleString()}
            />
          </dl>
          {pending.extracted.photo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={pending.extracted.photo_url}
              alt="Property"
              className="mt-4 w-full rounded border border-slate-800 max-h-64 object-cover"
            />
          )}
          {pending.extracted.market_notes && (
            <div className="mt-4 pt-4 border-t border-slate-800">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                Market Notes
              </div>
              <p className="text-sm text-slate-300 whitespace-pre-wrap">
                {pending.extracted.market_notes}
              </p>
            </div>
          )}
        </div>

        {/* Original email */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
            Original Email
          </h2>
          {email ? (
            <>
              <dl className="space-y-2 text-sm mb-4">
                <Row label="From" value={email.from_name ? `${email.from_name} <${email.from}>` : email.from} />
                <Row label="Subject" value={email.subject} />
                <Row label="Received" value={new Date(email.received_at).toLocaleString()} />
                {email.attachments && email.attachments.length > 0 && (
                  <Row
                    label="Attachments"
                    value={email.attachments.map((a) => a.name).join(", ")}
                  />
                )}
              </dl>
              <div className="border-t border-slate-800 pt-3">
                <pre className="text-xs text-slate-400 whitespace-pre-wrap font-sans max-h-96 overflow-y-auto">
                  {email.text_body || "(no plain text body)"}
                </pre>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Original email no longer available.</p>
          )}
        </div>
      </div>

      {pending.status === "approved" && pending.approved_deal_id && (
        <Link
          href={`/deals/${pending.approved_deal_id}`}
          className="inline-block text-sm text-blue-400 hover:text-blue-300"
        >
          → View created deal
        </Link>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-slate-500 uppercase tracking-wider pt-0.5 shrink-0">{label}</dt>
      <dd className="text-slate-200 text-right break-words">
        {value || <span className="text-slate-600 italic">—</span>}
      </dd>
    </div>
  );
}
