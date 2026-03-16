"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Check } from "lucide-react";
import type { NotificationPrefs } from "@/lib/validations";

const defaultPrefs: NotificationPrefs = {
  email_digest: false,
  digest_frequency: "daily",
  stale_deal_alerts: true,
  task_due_reminders: true,
  task_reminder_hours: 24,
  dd_expiration_alerts: true,
  closing_reminders: true,
};

function Toggle({
  enabled,
  onToggle,
  disabled,
}: {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
        enabled ? "bg-blue-600" : "bg-slate-700"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          enabled ? "translate-x-5" : "translate-x-0.5"
        } mt-0.5`}
      />
    </button>
  );
}

export function NotificationPrefsForm({
  initialPrefs,
}: {
  initialPrefs?: Partial<NotificationPrefs>;
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    ...defaultPrefs,
    ...initialPrefs,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function updatePref<K extends keyof NotificationPrefs>(
    key: K,
    value: NotificationPrefs[K]
  ) {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_prefs: prefs }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save preferences");
      }
      setSuccess("Preferences saved");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {/* Email Digest */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-slate-300">Email Digest</Label>
          <p className="text-slate-500 text-xs mt-0.5">
            Receive a summary of deal activity via email
          </p>
        </div>
        <Toggle
          enabled={prefs.email_digest}
          onToggle={() => updatePref("email_digest", !prefs.email_digest)}
        />
      </div>

      {/* Digest Frequency */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-slate-300">Digest Frequency</Label>
          <p className="text-slate-500 text-xs mt-0.5">
            How often to receive the email digest
          </p>
        </div>
        <select
          value={prefs.digest_frequency}
          onChange={(e) =>
            updatePref(
              "digest_frequency",
              e.target.value as "daily" | "weekly" | "never"
            )
          }
          disabled={!prefs.email_digest}
          className={`bg-slate-800 border border-slate-700 text-white text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            !prefs.email_digest ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="never">Never</option>
        </select>
      </div>

      <div className="border-t border-slate-800 pt-4 space-y-5">
        {/* Stale Deal Alerts */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-slate-300">Stale Deal Alerts</Label>
            <p className="text-slate-500 text-xs mt-0.5">
              Get notified when deals have no activity for an extended period
            </p>
          </div>
          <Toggle
            enabled={prefs.stale_deal_alerts}
            onToggle={() =>
              updatePref("stale_deal_alerts", !prefs.stale_deal_alerts)
            }
          />
        </div>

        {/* Task Due Reminders */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-slate-300">Task Due Reminders</Label>
            <p className="text-slate-500 text-xs mt-0.5">
              Remind you before tasks are due
            </p>
          </div>
          <Toggle
            enabled={prefs.task_due_reminders}
            onToggle={() =>
              updatePref("task_due_reminders", !prefs.task_due_reminders)
            }
          />
        </div>

        {/* Task Reminder Hours */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-slate-300">Task Reminder Hours</Label>
            <p className="text-slate-500 text-xs mt-0.5">
              Hours before due date to send reminder
            </p>
          </div>
          <Input
            type="number"
            min={1}
            max={168}
            value={prefs.task_reminder_hours}
            onChange={(e) =>
              updatePref("task_reminder_hours", Number(e.target.value) || 24)
            }
            disabled={!prefs.task_due_reminders}
            className={`bg-slate-800 border-slate-700 text-white w-20 text-center ${
              !prefs.task_due_reminders ? "opacity-50 cursor-not-allowed" : ""
            }`}
          />
        </div>

        {/* DD Expiration Alerts */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-slate-300">DD Expiration Alerts</Label>
            <p className="text-slate-500 text-xs mt-0.5">
              Alert when due diligence periods are about to expire
            </p>
          </div>
          <Toggle
            enabled={prefs.dd_expiration_alerts}
            onToggle={() =>
              updatePref("dd_expiration_alerts", !prefs.dd_expiration_alerts)
            }
          />
        </div>

        {/* Closing Reminders */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-slate-300">Closing Reminders</Label>
            <p className="text-slate-500 text-xs mt-0.5">
              Get reminders as closing dates approach
            </p>
          </div>
          <Toggle
            enabled={prefs.closing_reminders}
            onToggle={() =>
              updatePref("closing_reminders", !prefs.closing_reminders)
            }
          />
        </div>
      </div>

      <div className="border-t border-slate-800 pt-4 flex items-center gap-3">
        <Button
          type="submit"
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 text-white"
          size="sm"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Save Preferences"
          )}
        </Button>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {success && (
          <p className="text-green-400 text-sm flex items-center gap-1">
            <Check className="h-3.5 w-3.5" /> {success}
          </p>
        )}
      </div>
    </form>
  );
}
