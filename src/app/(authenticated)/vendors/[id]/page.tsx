import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Phone, Mail, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRedis } from "@/lib/db";
import { getVendor, listDealVendorsByVendor } from "@/lib/vendor-store";
import { STAGE_LABELS } from "@/lib/constants";
import {
  VENDOR_CATEGORY_LABELS,
  VENDOR_STATUS_LABELS,
  DEAL_VENDOR_STATUS_LABELS,
} from "@/lib/vendors";
import { VendorFormDialog } from "@/components/vendors/vendor-form-dialog";
import { DeleteVendorButton } from "@/components/vendors/delete-vendor-button";
import { STATUS_TONE } from "@/components/vendors/vendor-list";
import { AdminOnly } from "@/components/layout/admin-only";
import type { Deal } from "@/lib/validations";

const usd = (n: number | null | undefined) => (typeof n === "number" ? `$${n.toLocaleString("en-US")}` : "—");

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vendor = await getVendor(id).catch(() => null);
  if (!vendor) notFound();

  const links = await listDealVendorsByVendor(id).catch(() => []);
  const deals = new Map<string, Deal>();
  if (links.length > 0) {
    const pipeline = getRedis().pipeline();
    for (const l of links) pipeline.get(`deal:${l.deal_id}`);
    const rows = await pipeline.exec<(Deal | null)[]>().catch(() => []);
    for (const d of rows) if (d) deals.set(d.id, d);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/vendors" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-blue-400 mb-3">
          <ArrowLeft className="h-4 w-4" /> Vendors
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">{vendor.name}</h1>
            <p className="text-slate-400 text-sm mt-1">
              {VENDOR_CATEGORY_LABELS[vendor.category]}{vendor.company ? ` · ${vendor.company}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full ${STATUS_TONE[vendor.status]}`}>{VENDOR_STATUS_LABELS[vendor.status]}</span>
            <VendorFormDialog vendor={vendor} />
            <AdminOnly><DeleteVendorButton vendorId={vendor.id} vendorName={vendor.name} /></AdminOnly>
          </div>
        </div>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500 mb-1">Contact</p>
            <p className="text-slate-200 flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-slate-500" />{vendor.contact_name || "—"}</p>
            {vendor.phone && <a href={`tel:${vendor.phone.replace(/[^0-9+]/g, "")}`} className="text-blue-400 hover:underline flex items-center gap-1.5 mt-1"><Phone className="h-3.5 w-3.5" />{vendor.phone}</a>}
            {vendor.email && <a href={`mailto:${vendor.email}`} className="text-blue-400 hover:underline flex items-center gap-1.5 mt-1"><Mail className="h-3.5 w-3.5" />{vendor.email}</a>}
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Website</p>
            {vendor.website && /^https?:\/\//i.test(vendor.website)
              ? <a href={vendor.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1 break-all">{vendor.website.replace(/^https?:\/\//, "")}<ExternalLink className="h-3 w-3 shrink-0" /></a>
              : <p className="text-slate-400">—</p>}
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Markets</p>
            <p className="text-slate-200">{vendor.markets.join(", ") || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Suggested at stages</p>
            <p className="text-slate-200">{vendor.stage_triggers.map((s) => STAGE_LABELS[s]).join(", ") || "—"}</p>
          </div>
          {vendor.notes && (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-xs text-slate-500 mb-1">Notes</p>
              <p className="text-slate-300 whitespace-pre-wrap">{vendor.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2"><CardTitle className="text-white text-base">Offerings</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {vendor.offerings.length === 0 ? <p className="text-sm text-slate-500">No offerings recorded.</p> : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-1.5 pr-3 font-medium">Offering</th>
                  <th className="text-right py-1.5 px-2 font-medium">Price from</th>
                  <th className="text-left py-1.5 px-2 font-medium">Turnaround</th>
                  <th className="text-right py-1.5 px-2 font-medium">Max price</th>
                  <th className="text-right py-1.5 px-2 font-medium">Max reno</th>
                  <th className="text-left py-1.5 px-2 font-medium">Audit protection</th>
                  <th className="text-left py-1.5 px-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {vendor.offerings.map((o) => (
                  <tr key={o.id} className="border-b border-slate-800/50 align-top">
                    <td className="py-1.5 pr-3 text-slate-200">
                      {o.name}
                      {o.property_types && <div className="text-[11px] text-slate-500">{o.property_types}</div>}
                      {o.price_notes && <div className="text-[11px] text-slate-500">{o.price_notes}</div>}
                    </td>
                    <td className="py-1.5 px-2 text-right text-slate-200 tabular-nums">{o.price_from == null ? "Quote" : usd(o.price_from)}</td>
                    <td className="py-1.5 px-2 text-slate-300">{o.turnaround || "—"}</td>
                    <td className="py-1.5 px-2 text-right text-slate-300 tabular-nums">{o.max_purchase_price == null ? "No cap" : `< ${usd(o.max_purchase_price)}`}</td>
                    <td className="py-1.5 px-2 text-right text-slate-300 tabular-nums">{o.max_renovation_spend == null ? "No cap" : `< ${usd(o.max_renovation_spend)}`}</td>
                    <td className="py-1.5 px-2 text-slate-300">{o.audit_protection_included ? "Included" : o.audit_protection_price != null ? `${usd(o.audit_protection_price)} add-on` : "—"}</td>
                    <td className="py-1.5 px-2 text-slate-400">
                      {o.source_url && /^https?:\/\//i.test(o.source_url)
                        ? <a href={o.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">link</a>
                        : "—"}
                      {o.source_checked_date && <div className="text-[11px] text-slate-500">checked {o.source_checked_date}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2"><CardTitle className="text-white text-base">Deals &amp; quote history</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {links.length === 0 ? <p className="text-sm text-slate-500">Not linked to any deal yet. Request a quote from a deal&apos;s Vendors panel.</p> : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-1.5 pr-3 font-medium">Deal</th>
                  <th className="text-left py-1.5 px-2 font-medium">Offering</th>
                  <th className="text-left py-1.5 px-2 font-medium">Status</th>
                  <th className="text-right py-1.5 px-2 font-medium">Quote</th>
                  <th className="text-left py-1.5 px-2 font-medium">Quote date</th>
                </tr>
              </thead>
              <tbody>
                {links.map((l) => {
                  const d = deals.get(l.deal_id);
                  const off = vendor.offerings.find((o) => o.id === l.offering_id);
                  return (
                    <tr key={l.id} className="border-b border-slate-800/50">
                      <td className="py-1.5 pr-3">
                        {d ? <Link href={`/deals/${d.id}`} className="text-blue-400 hover:underline">{d.address}, {d.city}</Link> : <span className="text-slate-500">Deal removed</span>}
                      </td>
                      <td className="py-1.5 px-2 text-slate-300">{off?.name ?? "—"}</td>
                      <td className="py-1.5 px-2 text-slate-300">{DEAL_VENDOR_STATUS_LABELS[l.status]}</td>
                      <td className="py-1.5 px-2 text-right text-slate-200 tabular-nums">{usd(l.quote_amount)}</td>
                      <td className="py-1.5 px-2 text-slate-400">{l.quote_date || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
