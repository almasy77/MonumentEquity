"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Check } from "lucide-react";

export function ProfileForm({ initialName, email: initialEmail }: { initialName: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update profile");
      }
      setSuccess("Profile updated");
      router.refresh();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change password");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password changed successfully");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Name & Email */}
      <form onSubmit={handleSaveProfile} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-slate-300">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>
          <div>
            <Label className="text-slate-300">Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>
        </div>
        <Button
          type="submit"
          disabled={loading || (name === initialName && email === initialEmail)}
          className="bg-blue-600 hover:bg-blue-700 text-white"
          size="sm"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Profile"}
        </Button>
      </form>

      {/* Password Change */}
      <div className="border-t border-slate-800 pt-4">
        <h4 className="text-sm font-medium text-white mb-3">Change Password</h4>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <Label className="text-slate-300 text-xs">Current Password</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300 text-xs">New Password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                required
                minLength={8}
              />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Confirm Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                required
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={loading || !currentPassword || !newPassword}
            className="bg-blue-600 hover:bg-blue-700 text-white"
            size="sm"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Change Password"}
          </Button>
        </form>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {success && (
        <p className="text-green-400 text-sm flex items-center gap-1">
          <Check className="h-3.5 w-3.5" /> {success}
        </p>
      )}
    </div>
  );
}
