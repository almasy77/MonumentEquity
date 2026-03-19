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
import { ProfileForm } from "@/components/settings/profile-form";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";
import { ChecklistTemplateViewer } from "@/components/settings/checklist-template-viewer";
import { TeamManagement } from "@/components/settings/team-management";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { getEntity } from "@/lib/db";
import type { User } from "@/lib/validations";

export default async function SettingsPage() {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  // Fetch full user profile for notification prefs
  const user = session?.user?.id
    ? await getEntity<User>(`user:${session.user.id}`)
    : null;

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

  const generalContent = (
    <div className="space-y-6">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Profile & Security</CardTitle>
          <CardDescription className="text-slate-400">
            Update your name, email, and password
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            initialName={session.user.name || ""}
            email={session.user.email || ""}
          />
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Notification Preferences</CardTitle>
          <CardDescription className="text-slate-400">
            Configure how and when you receive alerts and reminders
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationPrefsForm
            initialPrefs={user?.notification_prefs ?? undefined}
          />
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Checklist Templates</CardTitle>
          <CardDescription className="text-slate-400">
            Review the checklist templates applied to deals at each stage.
            Sourced from the Durham First-Deal Playbook.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChecklistTemplateViewer />
        </CardContent>
      </Card>
    </div>
  );

  const assumptionsContent = (
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
  );

  const teamContent = (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white">Team</CardTitle>
        <CardDescription className="text-slate-400">
          Manage team members and read-only access
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TeamManagement />
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-slate-400 text-sm mt-1">
          Profile, underwriting defaults, team, and checklist templates
        </p>
      </div>

      <SettingsTabs
        generalContent={generalContent}
        assumptionsContent={assumptionsContent}
        teamContent={teamContent}
      />
    </div>
  );
}
