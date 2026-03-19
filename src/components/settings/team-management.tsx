"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Copy, Check, Eye } from "lucide-react";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-blue-900/50 text-blue-400 border-blue-800",
  va: "bg-purple-900/50 text-purple-400 border-purple-800",
  viewer: "bg-slate-800 text-slate-400 border-slate-700",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  va: "VA",
  viewer: "Read-Only",
};

export function TeamManagement() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [copied, setCopied] = useState(false);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/team");
      if (res.ok) {
        const data = await res.json();
        setMembers(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setTempPassword("");
    setInviting(true);

    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to invite");
      }
      setTempPassword(data.temp_password);
      setInvitedEmail(data.email);
      setName("");
      setEmail("");
      fetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm("Remove this team member? They will lose access immediately.")) return;

    try {
      const res = await fetch(`/api/team?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.id !== id));
      }
    } catch {
      // ignore
    }
  }

  function copyCredentials() {
    const text = `Email: ${invitedEmail}\nTemporary Password: ${tempPassword}\n\nPlease log in and change your password.`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Existing members */}
      {members.length > 0 ? (
        <div className="border border-slate-800 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Email</th>
                <th className="text-left px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="px-3 py-2 text-white">{member.name}</td>
                  <td className="px-3 py-2 text-slate-300">{member.email}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={`text-xs ${ROLE_STYLES[member.role] || ""}`}>
                      {member.role === "viewer" && <Eye className="h-3 w-3 mr-1" />}
                      {ROLE_LABELS[member.role] || member.role}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {member.role !== "admin" && (
                      <button
                        onClick={() => handleRemove(member.id)}
                        className="text-slate-600 hover:text-red-400 p-1"
                        title="Remove member"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500 text-center py-4">No team members yet. Invite someone below.</p>
      )}

      {/* Temp password display */}
      {tempPassword && (
        <div className="bg-green-900/20 border border-green-800 rounded-md p-3 space-y-2">
          <p className="text-sm text-green-400 font-medium">Viewer invited successfully!</p>
          <div className="text-xs text-slate-300 space-y-1">
            <p>Temporary password: <code className="bg-slate-800 px-1.5 py-0.5 rounded text-green-400">{tempPassword}</code></p>
            <p className="text-slate-500">Share these credentials with the viewer. They should change their password after first login.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={copyCredentials}
            className="h-7 text-xs border-slate-700 text-slate-300"
          >
            {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
            {copied ? "Copied!" : "Copy Credentials"}
          </Button>
        </div>
      )}

      {/* Invite form */}
      {showForm ? (
        <form onSubmit={handleInvite} className="border border-slate-800 rounded-md p-4 space-y-3">
          <h4 className="text-sm font-medium text-white">Invite Read-Only Viewer</h4>
          <p className="text-xs text-slate-500">Viewers can see all deals and scenarios but cannot edit, delete, or export anything.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300 text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                placeholder="John Doe"
                required
              />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                placeholder="john@example.com"
                required
              />
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={inviting} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
              {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Invite"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setError(""); setTempPassword(""); }} className="border-slate-700 text-slate-300">
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowForm(true)}
          className="border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Read-Only Viewer
        </Button>
      )}
    </div>
  );
}
