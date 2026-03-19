"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface SettingsTabsProps {
  generalContent: React.ReactNode;
  assumptionsContent: React.ReactNode;
  teamContent: React.ReactNode;
}

export function SettingsTabs({ generalContent, assumptionsContent, teamContent }: SettingsTabsProps) {
  return (
    <Tabs defaultValue="general">
      <TabsList className="bg-slate-800/50 border border-slate-700">
        <TabsTrigger value="general" className="text-slate-300 data-active:text-white data-active:bg-slate-700">
          General
        </TabsTrigger>
        <TabsTrigger value="assumptions" className="text-slate-300 data-active:text-white data-active:bg-slate-700">
          Assumptions
        </TabsTrigger>
        <TabsTrigger value="team" className="text-slate-300 data-active:text-white data-active:bg-slate-700">
          Team
        </TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="mt-4">
        {generalContent}
      </TabsContent>

      <TabsContent value="assumptions" className="mt-4">
        {assumptionsContent}
      </TabsContent>

      <TabsContent value="team" className="mt-4">
        {teamContent}
      </TabsContent>
    </Tabs>
  );
}
