"use client";

import { Sidebar } from "./sidebar";
import { GlobalSearch } from "./global-search";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />
      <main className="md:pl-60 pb-20 md:pb-0">
        {/* Top bar with global search */}
        <div className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-sm border-b border-slate-800/50 px-4 md:px-6 lg:px-8 py-3">
          <div className="max-w-7xl mx-auto flex justify-end">
            <GlobalSearch />
          </div>
        </div>
        <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
