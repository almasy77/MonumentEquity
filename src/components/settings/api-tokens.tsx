"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Copy, Check, KeyRound } from "lucide-react";

interface ApiToken {
  id: string;
  name: string;
  created_at: string;
  last_used_at?: string;
  revoked_at?: string;
}

function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleString() : "Never";
}

export function ApiTokens() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [newToken, setNewToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tokens");
      if (res.ok) setTokens(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create token");
        return;
      }
      setNewToken(data.token);
      setName("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    setConfirmId(null);
    if (res.ok) await load();
  }

  async function copy() {
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Tokens let agents and scripts call the API without a browser login. Every token has VA
        permissions: it can read, add leads and edit deals and scenarios, but it cannot change a
        deal&apos;s stage or status, delete anything, or change settings.
      </p>

      {newToken && (
        <div className="rounded-md border border-amber-800 bg-amber-950/40 p-3 space-y-2">
          <p className="text-sm text-amber-300">Copy this token now. It will not be shown again.</p>
          <div className="flex gap-2">
            <Input readOnly value={newToken} className="font-mono text-xs bg-slate-950 border-slate-700" />
            <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="Copy token">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setNewToken("")}>
            Done
          </Button>
        </div>
      )}

      <form onSubmit={create} className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="token-name" className="text-slate-300">New token name</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Scout agent"
            maxLength={60}
            className="bg-slate-950 border-slate-700"
          />
        </div>
        <Button type="submit" disabled={creating || !name.trim()}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span className="ml-1">Create</span>
        </Button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
      ) : tokens.length === 0 ? (
        <p className="text-sm text-slate-500">No tokens yet.</p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-md border border-slate-800">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-slate-500" />
                  <span className="font-medium text-white truncate">{t.name}</span>
                  {t.revoked_at ? (
                    <Badge variant="outline" className="border-red-800 text-red-400">Revoked</Badge>
                  ) : (
                    <Badge variant="outline" className="border-purple-800 text-purple-400">VA</Badge>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Created {fmt(t.created_at)} · Last used {fmt(t.last_used_at)}
                </p>
              </div>
              {!t.revoked_at &&
                (confirmId === t.id ? (
                  <div className="flex gap-1">
                    <Button type="button" variant="destructive" size="sm" onClick={() => revoke(t.id)}>
                      Confirm revoke
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirmId(t.id)}>
                    Revoke
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
