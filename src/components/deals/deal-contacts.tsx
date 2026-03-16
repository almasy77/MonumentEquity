"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Plus, X, Search, UserPlus } from "lucide-react";
import { CONTACT_TYPE_LABELS } from "@/lib/constants";
import type { Contact } from "@/lib/validations";

function getDisplayName(c: Contact): string {
  if (c.first_name) {
    return `${c.first_name}${c.nickname ? ` "${c.nickname}"` : ""} ${c.last_name || ""}`.trim();
  }
  return (c as unknown as Record<string, unknown>).name as string || "Unnamed";
}

interface DealContactsProps {
  dealId: string;
  contacts: Contact[];
  contactIds: string[];
}

export function DealContacts({ dealId, contacts: initial, contactIds: initialIds }: DealContactsProps) {
  const router = useRouter();
  const [contacts, setContacts] = useState(initial);
  const [contactIds, setContactIds] = useState(initialIds);
  const [showAdd, setShowAdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newType, setNewType] = useState("broker");
  const [newCompany, setNewCompany] = useState("");
  const [saving, setSaving] = useState(false);

  const searchContacts = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        // Filter to contacts only and exclude already-linked
        const contactResults = data.filter(
          (r: { type: string; id: string }) => r.type === "contact" && !contactIds.includes(r.id)
        );
        // Fetch full contact objects
        if (contactResults.length > 0) {
          const contactFetches = await Promise.all(
            contactResults.map((r: { id: string }) => fetch(`/api/contacts/${r.id}`).then((res) => res.ok ? res.json() : null))
          );
          setSearchResults(contactFetches.filter(Boolean));
        } else {
          setSearchResults([]);
        }
      }
    } catch {
      // silent
    } finally {
      setSearching(false);
    }
  }, [contactIds]);

  useEffect(() => {
    const timer = setTimeout(() => searchContacts(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchContacts]);

  async function linkContact(contactId: string, contact: Contact) {
    const newIds = [...contactIds, contactId];
    const res = await fetch(`/api/deals/${dealId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_ids: newIds }),
    });
    if (res.ok) {
      setContactIds(newIds);
      setContacts((prev) => [...prev, contact]);
      setSearchQuery("");
      setSearchResults([]);
      setShowAdd(false);
      router.refresh();
    }
  }

  async function unlinkContact(contactId: string) {
    const newIds = contactIds.filter((id) => id !== contactId);
    const res = await fetch(`/api/deals/${dealId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_ids: newIds }),
    });
    if (res.ok) {
      setContactIds(newIds);
      setContacts((prev) => prev.filter((c) => c.id !== contactId));
      router.refresh();
    }
  }

  async function createAndLink() {
    if (!newFirst.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: newFirst.trim(),
          last_name: newLast.trim() || undefined,
          email: newEmail.trim() || undefined,
          type: newType,
          company: newCompany.trim() || undefined,
        }),
      });
      if (res.ok) {
        const contact = await res.json();
        await linkContact(contact.id, contact);
        setShowNewForm(false);
        setNewFirst("");
        setNewLast("");
        setNewEmail("");
        setNewCompany("");
        setNewType("broker");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsibleCard
      title="Contacts"
      icon={<Users className="h-4 w-4 text-green-400" />}
      headerRight={
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setShowAdd(!showAdd); setShowNewForm(false); }}
          className="h-7 text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
      }
    >
      {/* Existing contacts */}
      {contacts.length === 0 && !showAdd && (
        <p className="text-sm text-slate-500">No contacts linked</p>
      )}
      {contacts.length > 0 && (
        <div className="space-y-2 mb-3">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between group text-sm">
              <div>
                <p className="text-slate-200 font-medium">{getDisplayName(c)}</p>
                <p className="text-slate-500 text-xs">
                  {CONTACT_TYPE_LABELS[c.type]}
                  {c.company && ` — ${c.company}`}
                </p>
                {c.email && <p className="text-slate-400 text-xs">{c.email}</p>}
              </div>
              <button
                onClick={() => unlinkContact(c.id)}
                className="p-1 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove from deal"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add contact dropdown */}
      {showAdd && (
        <div className="border-t border-slate-800 pt-3 space-y-2">
          {/* Search existing */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search existing contacts..."
              className="pl-8 bg-slate-800 border-slate-700 text-white h-8 text-sm"
              autoFocus
            />
          </div>

          {/* Search results */}
          {searching && <p className="text-xs text-slate-500">Searching...</p>}
          {searchResults.length > 0 && (
            <div className="max-h-36 overflow-y-auto space-y-1">
              {searchResults.map((c) => (
                <button
                  key={c.id}
                  onClick={() => linkContact(c.id, c)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 text-sm flex items-center gap-2"
                >
                  <Users className="h-3 w-3 text-green-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-slate-200">{getDisplayName(c)}</span>
                    <span className="text-slate-500 text-xs ml-1">
                      {CONTACT_TYPE_LABELS[c.type]}{c.company ? ` — ${c.company}` : ""}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Or create new */}
          {!showNewForm ? (
            <button
              onClick={() => setShowNewForm(true)}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              <UserPlus className="h-3 w-3" /> Create new contact
            </button>
          ) : (
            <div className="space-y-2 border border-slate-800 rounded p-2">
              <p className="text-xs text-slate-400 font-medium">New Contact</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={newFirst}
                  onChange={(e) => setNewFirst(e.target.value)}
                  placeholder="First name *"
                  className="bg-slate-800 border-slate-700 text-white h-7 text-xs"
                />
                <Input
                  value={newLast}
                  onChange={(e) => setNewLast(e.target.value)}
                  placeholder="Last name"
                  className="bg-slate-800 border-slate-700 text-white h-7 text-xs"
                />
                <Input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Email"
                  className="bg-slate-800 border-slate-700 text-white h-7 text-xs"
                />
                <Input
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="Company"
                  className="bg-slate-800 border-slate-700 text-white h-7 text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white flex-1 outline-none"
                >
                  {Object.entries(CONTACT_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  onClick={createAndLink}
                  disabled={saving || !newFirst.trim()}
                  className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {saving ? "Saving..." : "Add & Link"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowNewForm(false)}
                  className="h-7 text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </CollapsibleCard>
  );
}
