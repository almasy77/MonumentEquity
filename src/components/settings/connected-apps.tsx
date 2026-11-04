"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plug, Trash2 } from "lucide-react";

interface Grant {
  id: string;
  client_name: string;
  created_at: string;
  last_used_at: string | null;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

/** Claude (MCP connector) authorizations for the signed-in user, with one-click revoke. */
export function ConnectedApps() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/oauth/grants");
      if (!res.ok) throw new Error("Could not load connected apps");
      setGrants(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load connected apps");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(query: string, key: string) {
    setBusy(key);
    setError("");
    try {
      const res = await fetch(`/api/oauth/grants?${query}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Revoke failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revoke failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Apps you have authorized to act as you through the Claude connector. Revoking takes effect
        immediately; the app has to be re-authorized (Claude → Settings → Connectors) to get back in.
      </p>
      {grants === null && !error && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
      {grants?.length === 0 && <p className="text-sm text-slate-500">No connected apps.</p>}
      {grants?.map((g) => (
        <div key={g.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-800 p-3">
          <div className="min-w-0">
            <p className="text-sm text-white flex items-center gap-1.5">
              <Plug className="h-3.5 w-3.5 text-slate-400" /> {g.client_name}
            </p>
            <p className="text-xs text-slate-500">
              Connected {fmt(g.created_at)} · last used {fmt(g.last_used_at)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => revoke(`id=${encodeURIComponent(g.id)}`, g.id)}
            className="border-slate-700 text-red-400 hover:bg-slate-800 shrink-0"
          >
            {busy === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
            Revoke
          </Button>
        </div>
      ))}
      {grants && grants.length > 1 && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => revoke("all=1", "all")}
          className="border-slate-700 text-red-400 hover:bg-slate-800"
        >
          Revoke all
        </Button>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
