import { auth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Shield } from "lucide-react";
import { DefaultAssumptionsForm } from "@/components/settings/default-assumptions-form";

export default async function SettingsPage() {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  if (!isAdmin) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-slate-400 text-sm mt-1">Account information</p>
        </div>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-8 text-center">
            <Shield className="h-10 w-10 text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">Admin Only</h3>
            <p className="text-slate-400 text-sm">
              Settings can only be modified by administrators.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-slate-400 text-sm mt-1">
          Profile, default assumptions, and checklist templates
        </p>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Profile</CardTitle>
          <CardDescription className="text-slate-400">
            Your account information
          </CardDescription>
        </CardHeader>
        <CardContent className="text-slate-400 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-slate-500">Name</span>
              <p className="text-slate-200">{session.user.name}</p>
            </div>
            <div>
              <span className="text-slate-500">Email</span>
              <p className="text-slate-200">{session.user.email}</p>
            </div>
            <div>
              <span className="text-slate-500">Role</span>
              <p className="text-slate-200 capitalize">{session.user.role}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Default Assumptions</CardTitle>
          <CardDescription className="text-slate-400">
            Standard underwriting defaults that pre-fill new scenarios.
            Changes here apply to all future scenarios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DefaultAssumptionsForm />
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Checklist Templates</CardTitle>
          <CardDescription className="text-slate-400">
            Customize due diligence, closing, and onboarding checklists
          </CardDescription>
        </CardHeader>
        <CardContent className="text-slate-400 text-sm">
          Checklist template management will be available here.
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Team</CardTitle>
          <CardDescription className="text-slate-400">
            Manage VA access
          </CardDescription>
        </CardHeader>
        <CardContent className="text-slate-400 text-sm">
          VA management will be available here.
        </CardContent>
      </Card>
    </div>
  );
}
