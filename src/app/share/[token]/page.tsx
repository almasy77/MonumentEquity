import { notFound } from "next/navigation";
import { getRedis } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Building2, DollarSign, TrendingUp, Shield } from "lucide-react";
import { STAGE_LABELS } from "@/lib/constants";
import type { Deal, Scenario, ShareLink } from "@/lib/validations";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const redis = getRedis();

  // Validate token
  const share = await redis.get<ShareLink>(`share:${token}`);
  if (!share) return notFound();

  // Check expiration
  if (new Date(share.expires_at).getTime() < Date.now()) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Card className="bg-slate-900 border-slate-800 max-w-md">
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 text-slate-600 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Link Expired</h2>
            <p className="text-slate-400 text-sm">
              This share link has expired. Please request a new one from the deal owner.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fetch deal
  const deal = await redis.get<Deal>(`deal:${share.deal_id}`);
  if (!deal) return notFound();

  // Fetch scenarios
  const scenarioIds = await redis.zrange(`scenarios:by_deal:${deal.id}`, 0, -1);
  let scenarios: Scenario[] = [];
  if (scenarioIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of scenarioIds) {
      pipeline.get(`scenario:${id}`);
    }
    const results = await pipeline.exec<(Scenario | null)[]>();
    scenarios = results.filter((s): s is Scenario => {
      if (!s) return false;
      // If share specifies scenario_ids, filter to those
      if (share.scenario_ids && share.scenario_ids.length > 0) {
        return share.scenario_ids.includes(s.id);
      }
      return true;
    });
  }

  const pricePerUnit = deal.units > 0 ? deal.asking_price / deal.units : 0;
  const stage = STAGE_LABELS[deal.stage] || deal.stage;

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-2 text-slate-500 text-xs mb-6">
          <Shield className="h-3 w-3" />
          Read-only view shared by Monument Equity
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Building2 className="h-6 w-6 text-blue-500" />
            {deal.address}
          </h1>
          <p className="text-slate-400 mt-1">
            {deal.city}, {deal.state} {deal.zip || ""}
          </p>
          <Badge
            variant="outline"
            className="mt-2 border-blue-600 text-blue-400"
          >
            {stage}
          </Badge>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
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
        </div>

        {/* Property Details */}
        <Card className="bg-slate-900 border-slate-800 mb-6">
          <CardHeader>
            <CardTitle className="text-white text-base">
              Property Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-slate-500">Address</span>
                <p className="text-slate-200">
                  {deal.address}, {deal.city}, {deal.state} {deal.zip}
                </p>
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
            </div>
          </CardContent>
        </Card>

        {/* Scenarios */}
        {scenarios.length > 0 && (
          <Card className="bg-slate-900 border-slate-800 mb-6">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Underwriting Scenarios
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {scenarios.map((s) => {
                  const m = s.calculated_metrics;
                  return (
                    <div
                      key={s.id}
                      className="p-4 bg-slate-800/50 rounded-lg border border-slate-700"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-medium text-white">
                          {s.name}
                        </h4>
                        <Badge
                          variant="outline"
                          className="text-xs border-slate-600 text-slate-400"
                        >
                          {s.type}
                        </Badge>
                      </div>
                      {m && (
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-center">
                          {m.irr != null && (
                            <div>
                              <p className="text-xs text-slate-500">IRR</p>
                              <p className="text-sm font-bold text-white">
                                {formatPct(m.irr)}
                              </p>
                            </div>
                          )}
                          {m.cash_on_cash != null && (
                            <div>
                              <p className="text-xs text-slate-500">CoC</p>
                              <p className="text-sm font-bold text-white">
                                {formatPct(m.cash_on_cash)}
                              </p>
                            </div>
                          )}
                          {m.equity_multiple != null && (
                            <div>
                              <p className="text-xs text-slate-500">Eq Mult</p>
                              <p className="text-sm font-bold text-white">
                                {m.equity_multiple.toFixed(2)}x
                              </p>
                            </div>
                          )}
                          {m.dscr != null && (
                            <div>
                              <p className="text-xs text-slate-500">DSCR</p>
                              <p className="text-sm font-bold text-white">
                                {m.dscr.toFixed(2)}
                              </p>
                            </div>
                          )}
                          {m.going_in_cap != null && (
                            <div>
                              <p className="text-xs text-slate-500">
                                Going-In Cap
                              </p>
                              <p className="text-sm font-bold text-white">
                                {formatPct(m.going_in_cap)}
                              </p>
                            </div>
                          )}
                          {m.stabilized_cap != null && (
                            <div>
                              <p className="text-xs text-slate-500">
                                Stab Cap
                              </p>
                              <p className="text-sm font-bold text-white">
                                {formatPct(m.stabilized_cap)}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-slate-600 mt-8">
          Shared via Monument Equity &middot; This link expires{" "}
          {new Date(share.expires_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      </div>
    </div>
  );
}
