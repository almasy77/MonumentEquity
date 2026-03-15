import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { DEAL_STAGES, STAGE_LABELS } from "@/lib/constants";

export default function PipelinePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline</h1>
          <p className="text-slate-400 text-sm mt-1">
            Track deals through every stage
          </p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Deal
        </Button>
      </div>

      {/* Kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {DEAL_STAGES.filter(
          (s) => !["stabilized"].includes(s)
        ).map((stage) => (
          <div
            key={stage}
            className="flex-shrink-0 w-72"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-slate-300">
                {STAGE_LABELS[stage]}
              </h3>
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
                0
              </span>
            </div>
            <Card className="bg-slate-900/50 border-slate-800 min-h-[200px]">
              <CardContent className="p-3">
                <div className="flex items-center justify-center h-32 text-slate-600 text-sm">
                  No deals
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
