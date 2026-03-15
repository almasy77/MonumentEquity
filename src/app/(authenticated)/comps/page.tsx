import { getRedis } from "@/lib/db";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddMarketCompDialog } from "@/components/comps/add-market-comp-dialog";
import { AddRentCompDialog } from "@/components/comps/add-rent-comp-dialog";
import { MarketCompList } from "@/components/comps/market-comp-list";
import { RentCompList } from "@/components/comps/rent-comp-list";
import type { MarketComp, RentComp } from "@/lib/validations";

async function getMarketComps(): Promise<MarketComp[]> {
  try {
    const redis = getRedis();
    const ids = await redis.zrange("comps:all", 0, -1, { rev: true });
    if (ids.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`comp:${id}`);
    }
    const results = await pipeline.exec<(MarketComp | null)[]>();
    return results.filter((r): r is MarketComp => r !== null);
  } catch {
    return [];
  }
}

async function getRentComps(): Promise<RentComp[]> {
  try {
    const redis = getRedis();
    const ids = await redis.zrange("rent_comps:all", 0, -1, { rev: true });
    if (ids.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`rent_comp:${id}`);
    }
    const results = await pipeline.exec<(RentComp | null)[]>();
    return results.filter((r): r is RentComp => r !== null);
  } catch {
    return [];
  }
}

export default async function CompsPage() {
  const [marketComps, rentComps] = await Promise.all([
    getMarketComps(),
    getRentComps(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Comps</h1>
          <p className="text-slate-400 text-sm mt-1">
            Market sales and rent comparables
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AddRentCompDialog />
          <AddMarketCompDialog />
        </div>
      </div>

      <Tabs defaultValue="market" className="space-y-4">
        <TabsList className="bg-slate-900 border border-slate-800">
          <TabsTrigger
            value="market"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            Market Sales ({marketComps.length})
          </TabsTrigger>
          <TabsTrigger
            value="rent"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            Rent Comps ({rentComps.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="market">
          <MarketCompList comps={marketComps} />
        </TabsContent>

        <TabsContent value="rent">
          <RentCompList comps={rentComps} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
