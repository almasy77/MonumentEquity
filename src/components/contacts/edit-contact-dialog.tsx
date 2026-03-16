"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS } from "@/lib/constants";
import type { Contact, PhoneEntry } from "@/lib/validations";

const PHONE_LABELS = ["mobile", "office", "home", "fax", "other"];

export function EditContactDialog({
  contact,
  open,
  onClose,
}: {
  contact: Contact;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [firstName, setFirstName] = useState(contact.first_name || "");
  const [lastName, setLastName] = useState(contact.last_name || "");
  const [nickname, setNickname] = useState(contact.nickname || "");
  const [company, setCompany] = useState(contact.company || "");
  const [type, setType] = useState(contact.type);
  const [email, setEmail] = useState(contact.email || "");
  const [phones, setPhones] = useState<PhoneEntry[]>(
    contact.phones?.length ? contact.phones : contact.phone ? [{ number: contact.phone, label: "mobile" }] : [{ number: "", label: "mobile" }]
  );
  const [website, setWebsite] = useState(contact.website || "");
  const [notes, setNotes] = useState(contact.notes || "");

  function addPhone() {
    setPhones([...phones, { number: "", label: "mobile" }]);
  }

  function removePhone(index: number) {
    setPhones(phones.filter((_, i) => i !== index));
  }

  function updatePhone(index: number, field: "number" | "label", value: string) {
    const updated = [...phones];
    updated[index] = { ...updated[index], [field]: value };
    setPhones(updated);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName || undefined,
          nickname: nickname || undefined,
          company: company || undefined,
          type,
          email: email || undefined,
          phones: phones.filter((p) => p.number.trim()),
          website: website || undefined,
          notes: notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update contact");
      }

      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Edit Contact</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Name fields */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-slate-300 text-xs">First Name *</Label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Nickname</Label>
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                placeholder="e.g. JD"
              />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Last Name</Label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300 text-xs">Type *</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)} required>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {CONTACT_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="text-white hover:bg-slate-700">
                      {CONTACT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Company</Label>
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>

          {/* Phone numbers */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-slate-300 text-xs">Phone Numbers</Label>
              <button type="button" onClick={addPhone} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                <Plus className="h-3 w-3" /> Add Phone
              </button>
            </div>
            <div className="space-y-2">
              {phones.map((phone, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={phone.number}
                    onChange={(e) => updatePhone(i, "number", e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white flex-1"
                    placeholder="(919) 555-0123"
                  />
                  <Select value={phone.label} onValueChange={(v) => updatePhone(i, "label", v ?? "mobile")}>
                    <SelectTrigger className="bg-slate-800 border-slate-700 text-white w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      {PHONE_LABELS.map((l) => (
                        <SelectItem key={l} value={l} className="text-white hover:bg-slate-700">
                          {l.charAt(0).toUpperCase() + l.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {phones.length > 1 && (
                    <button type="button" onClick={() => removePhone(i)} className="p-2 text-slate-500 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Website</Label>
            <Input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
              placeholder="https://example.com"
            />
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[60px]"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
