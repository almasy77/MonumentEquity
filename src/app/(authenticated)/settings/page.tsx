import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DefaultAssumptionsForm } from "@/components/settings/default-assumptions-form";

export default function SettingsPage() {
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
          Profile settings will be available here.
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
