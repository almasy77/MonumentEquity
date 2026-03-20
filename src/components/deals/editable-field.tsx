"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X, AlertCircle } from "lucide-react";

interface EditableFieldProps {
    value: string;
    label: string;
    onSave: (value: string) => Promise<void>;
    type?: "text" | "number" | "url" | "date";
    prefix?: string;
    suffix?: string;
    placeholder?: string;
    noCommas?: boolean;
}

const numberFormatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
});

function formatDisplay(value: string, type: string, noCommas?: boolean): string {
    if (type === "number" && value && !noCommas) {
          const num = Number(value.replace(/,/g, ""));
          if (!isNaN(num)) return numberFormatter.format(num);
    }
    return value;
}

export function EditableField({
    value,
    label,
    onSave,
    type = "text",
  prefix,
    suffix,
    placeholder,
    noCommas,
}: EditableFieldProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
        if (editing) inputRef.current?.focus();
  }, [editing]);

  async function handleSave() {
        if (draft === value) {
                setEditing(false);
                setSaveError(false);
                return;
        }
        setSaving(true);
        setSaveError(false);
        try {
                await onSave(draft);
                setEditing(false);
        } catch {
                setSaveError(true);
                setDraft(value);
        } finally {
                setSaving(false);
        }
  }

  function handleCancel() {
        setDraft(value);
        setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter") handleSave();
        if (e.key === "Escape") handleCancel();
  }

  if (editing) {
        return (
                <div>
                        <span className="text-slate-500 text-xs">{label}</span>
                        <div className="flex items-center gap-1 mt-0.5">
                          {prefix && <span className="text-slate-400 text-sm">{prefix}</span>}
                                  <input
                                                ref={inputRef}
                                                type={type}
                                                value={draft}
                                                onChange={(e) => setDraft(e.target.value)}
                                                onKeyDown={handleKeyDown}
                                                className="bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-sm text-white w-full outline-none focus:border-blue-500"
                                                placeholder={placeholder}
                                              />
                          {suffix && <span className="text-slate-400 text-sm">{suffix}</span>}
                                  <button
                                                onClick={handleSave}
                                                disabled={saving}
                                                className="p-1 text-green-400 hover:text-green-300"
                                              >
                                              <Check className="h-3.5 w-3.5" />
                            </button>
                                  <button onClick={handleCancel} className="p-1 text-slate-500 hover:text-slate-300">
                                              <X className="h-3.5 w-3.5" />
                                  </button>
                        </div>
                </div>
              );
  }
  
            return (
      <div className="group">
        <span className="text-slate-500 text-xs">{label}</span>
                                          <div className="flex items-center gap-1">
                                                  <p className="text-slate-200 text-sm">
        {prefix}{value ? formatDisplay(value, type, noCommas) : <span className="text-slate-600 italic">{placeholder || "—"}</span>}{suffix}
    </p>
            {saveError && (
              <span className="flex items-center gap-0.5 text-red-400 text-xs" title="Save failed — click edit to try again">
                <AlertCircle className="h-3 w-3" /> Failed
              </span>
            )}
            <button
                                      onClick={() => { setDraft(value); setEditing(true); setSaveError(false); }}
                        className="p-0.5 text-slate-600 hover:text-blue-400 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                        title={`Edit ${label}`}
                      >
                      <Pencil className="h-3 w-3" />
            </button>
                                          </div>
      </div>
                );
}
