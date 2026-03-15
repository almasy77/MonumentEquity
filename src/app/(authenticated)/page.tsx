import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Building2, AlertTriangle, CheckSquare, TrendingUp } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">
          Pipeline overview and action items
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-slate-400">
              <Building2 className="h-4 w-4" />
              Active Deals
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">0</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-slate-400">
              <TrendingUp className="h-4 w-4" />
              Pipeline Value
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">$0</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-slate-400">
              <AlertTriangle className="h-4 w-4" />
              Overdue Tasks
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">0</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-slate-400">
              <CheckSquare className="h-4 w-4" />
              Stale Deals
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">0</div>
          </CardContent>
        </Card>
      </div>

      {/* Main content area */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Pipeline Summary</CardTitle>
            <CardDescription className="text-slate-400">
              Deals by stage
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
              Add your first deal to see the pipeline chart
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Needs Attention</CardTitle>
            <CardDescription className="text-slate-400">
              Stale deals, overdue tasks, expiring deadlines
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
              No items need attention right now
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-slate-500 text-sm">
            No recent activity
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
