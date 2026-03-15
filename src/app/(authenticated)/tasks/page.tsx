import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, CheckSquare } from "lucide-react";

export default function TasksPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tasks</h1>
          <p className="text-slate-400 text-sm mt-1">
            Follow-ups and action items across all deals
          </p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Task
        </Button>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-8">
          <div className="flex flex-col items-center justify-center text-center">
            <CheckSquare className="h-12 w-12 text-slate-600 mb-3" />
            <h3 className="text-lg font-medium text-slate-300">
              No tasks yet
            </h3>
            <p className="text-slate-500 text-sm mt-1 max-w-sm">
              Tasks are created automatically when deals progress through stages,
              or you can add them manually.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
