"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Clock, Pencil, Check, X } from "lucide-react";
import type { Task } from "@/lib/validations";

const PRIORITY_COLORS: Record<string, string> = {
  low: "border-slate-600 text-slate-400",
  medium: "border-blue-600 text-blue-400",
  high: "border-yellow-600 text-yellow-400",
  critical: "border-red-600 text-red-400",
};

function isOverdue(dueDate: string): boolean {
  return new Date(dueDate).getTime() < Date.now();
}

function formatDueDate(dueDate: string): string {
  const d = new Date(dueDate);
  const diff = d.getTime() - Date.now();
  const days = Math.ceil(diff / 86400000);

  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return `Due in ${days}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function EditableTask({ task, onSaved }: { task: Task; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [dueDate, setDueDate] = useState(task.due_date.split("T")[0]);
  const [priority, setPriority] = useState(task.priority);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || undefined,
          due_date: dueDate,
          priority,
        }),
      });
      if (res.ok) {
        setEditing(false);
        onSaved();
      }
    } catch (err) {
      console.error("Failed to update task:", err);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setTitle(task.title);
    setDescription(task.description || "");
    setDueDate(task.due_date.split("T")[0]);
    setPriority(task.priority);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="p-3 rounded-lg border border-blue-800/50 bg-slate-900 space-y-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="bg-slate-800 border-slate-700 text-white text-sm h-8"
          placeholder="Task title"
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="bg-slate-800 border-slate-700 text-white text-sm h-8"
          placeholder="Description (optional)"
        />
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="bg-slate-800 border-slate-700 text-white text-sm h-8 flex-1"
          />
          <Select value={priority} onValueChange={(v) => setPriority(v ?? priority)}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white text-sm h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              <SelectItem value="low" className="text-white hover:bg-slate-700">Low</SelectItem>
              <SelectItem value="medium" className="text-white hover:bg-slate-700">Medium</SelectItem>
              <SelectItem value="high" className="text-white hover:bg-slate-700">High</SelectItem>
              <SelectItem value="critical" className="text-white hover:bg-slate-700">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="h-8 bg-blue-600 hover:bg-blue-700 text-white px-2"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancel}
            className="h-8 border-slate-700 text-slate-400 hover:bg-slate-800 px-2"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="p-0.5 text-slate-600 hover:text-blue-400 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
      title="Edit task"
    >
      <Pencil className="h-3 w-3" />
    </button>
  );
}

export function TaskList({
  tasks,
  showDealInfo,
}: {
  tasks: Task[];
  showDealInfo?: boolean;
}) {
  const router = useRouter();

  async function toggleComplete(task: Task) {
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !task.completed }),
      });
      router.refresh();
    } catch (err) {
      console.error("Failed to toggle task:", err);
    }
  }

  const incomplete = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);
  const overdue = incomplete.filter((t) => isOverdue(t.due_date));

  return (
    <div className="space-y-3">
      {overdue.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-red-400 mb-2">
          <AlertCircle className="h-3 w-3" />
          {overdue.length} overdue task{overdue.length !== 1 ? "s" : ""}
        </div>
      )}

      {incomplete.length === 0 && completed.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-4">No tasks yet.</p>
      )}

      {incomplete.map((task) => (
        <div
          key={task.id}
          className={`group flex items-start gap-3 p-3 rounded-lg border ${
            isOverdue(task.due_date)
              ? "border-red-800/50 bg-red-900/10"
              : "border-slate-800 bg-slate-900"
          }`}
        >
          <Checkbox
            checked={false}
            onCheckedChange={() => toggleComplete(task)}
            className="mt-0.5 border-slate-600"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-sm text-white">{task.title}</p>
              <EditableTask task={task} onSaved={() => router.refresh()} />
            </div>
            {task.description && (
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                {task.description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <span
                className={`text-xs flex items-center gap-1 ${
                  isOverdue(task.due_date) ? "text-red-400" : "text-slate-500"
                }`}
              >
                <Clock className="h-3 w-3" />
                {formatDueDate(task.due_date)}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] ${PRIORITY_COLORS[task.priority]}`}
              >
                {task.priority}
              </Badge>
            </div>
          </div>
        </div>
      ))}

      {completed.length > 0 && (
        <div className="pt-2">
          <p className="text-xs text-slate-600 mb-2">
            Completed ({completed.length})
          </p>
          {completed.map((task) => (
            <div
              key={task.id}
              className="flex items-start gap-3 p-2 rounded-lg opacity-50"
            >
              <Checkbox
                checked={true}
                onCheckedChange={() => toggleComplete(task)}
                className="mt-0.5 border-slate-600"
              />
              <p className="text-sm text-slate-400 line-through">{task.title}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
