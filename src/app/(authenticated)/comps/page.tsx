import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, BarChart3 } from "lucide-react";

export default function CompsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Comps</h1>
          <p className="text-slate-400 text-sm mt-1">
            Market sales and rent comparables
          </p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Comp
        </Button>
      </div>

      <Tabs defaultValue="market" className="space-y-4">
        <TabsList className="bg-slate-900 border border-slate-800">
          <TabsTrigger
            value="market"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            Market Sales
          </TabsTrigger>
          <TabsTrigger
            value="rent"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            Rent Comps
          </TabsTrigger>
        </TabsList>

        <TabsContent value="market">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-8">
              <div className="flex flex-col items-center justify-center text-center">
                <BarChart3 className="h-12 w-12 text-slate-600 mb-3" />
                <h3 className="text-lg font-medium text-slate-300">
                  No market comps yet
                </h3>
                <p className="text-slate-500 text-sm mt-1 max-w-sm">
                  Add comparable sales to benchmark pricing and cap rates in your
                  target market.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rent">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-8">
              <div className="flex flex-col items-center justify-center text-center">
                <BarChart3 className="h-12 w-12 text-slate-600 mb-3" />
                <h3 className="text-lg font-medium text-slate-300">
                  No rent comps yet
                </h3>
                <p className="text-slate-500 text-sm mt-1 max-w-sm">
                  Add rent comparables to validate underwriting assumptions.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
