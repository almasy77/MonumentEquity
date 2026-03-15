import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckSquare } from "lucide-react";
import { TaskList } from "@/components/tasks/task-list";
import type { Task } from "@/lib/validations";

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) return null;

  const redis = getRedis();
  const ids = await redis.zrange("tasks:all", 0, -1, { rev: true });

  let tasks: Task[] = [];
  if (ids.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`task:${id}`);
    }
    const results = await pipeline.exec<(Task | null)[]>();
    tasks = results.filter((t): t is Task => t !== null);
  }

  // Load deal names for context
  const dealIds = [...new Set(tasks.map((t) => t.deal_id))];
  const dealNames: Record<string, string> = {};
  if (dealIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of dealIds) {
      pipeline.get(`deal:${id}`);
    }
    const deals = await pipeline.exec<({ address?: string; id: string } | null)[]>();
    for (const deal of deals) {
      if (deal) dealNames[deal.id] = deal.address || "Unknown";
    }
  }

  const incomplete = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tasks</h1>
          <p className="text-slate-400 text-sm mt-1">
            {incomplete.length} open · {completed.length} completed
          </p>
        </div>
      </div>

      {tasks.length === 0 ? (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-8">
            <div className="flex flex-col items-center justify-center text-center">
              <CheckSquare className="h-12 w-12 text-slate-600 mb-3" />
              <h3 className="text-lg font-medium text-slate-300">No tasks yet</h3>
              <p className="text-slate-500 text-sm mt-1 max-w-sm">
                Tasks are created from deal pages. Open a deal and add tasks there.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-lg">All Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <TaskList tasks={tasks} showDealInfo />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
