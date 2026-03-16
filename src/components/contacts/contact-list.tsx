"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, type ContactType } from "@/lib/constants";
import { getContactDisplayName, getContactSortName } from "@/lib/contact-utils";
import { Mail, Phone, Building2, Globe, Search, ArrowUpDown, Pencil } from "lucide-react";
import { EditContactDialog } from "./edit-contact-dialog";
import type { Contact } from "@/lib/validations";

type SortField = "name" | "company" | "type" | "created";

export function ContactList({ contacts }: { contacts: Contact[] }) {
  const [filter, setFilter] = useState<ContactType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  const filtered = useMemo(() => {
    let list = filter === "all" ? contacts : contacts.filter((c) => c.type === filter);

    // Search
    if (searchQuery.length >= 2) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => {
        const name = getContactDisplayName(c).toLowerCase();
        const company = (c.company || "").toLowerCase();
        const email = (c.email || "").toLowerCase();
        const notes = (c.notes || "").toLowerCase();
        const tags = (c.tags || []).join(" ").toLowerCase();
        return name.includes(q) || company.includes(q) || email.includes(q) || notes.includes(q) || tags.includes(q);
      });
    }

    // Sort
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = getContactSortName(a).localeCompare(getContactSortName(b));
          break;
        case "company":
          cmp = (a.company || "").localeCompare(b.company || "");
          break;
        case "type":
          cmp = a.type.localeCompare(b.type);
          break;
        case "created":
          cmp = a.created_at.localeCompare(b.created_at);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [contacts, filter, searchQuery, sortField, sortAsc]);

  const countByType = CONTACT_TYPES.reduce(
    (acc, t) => {
      acc[t] = contacts.filter((c) => c.type === t).length;
      return acc;
    },
    {} as Record<ContactType, number>
  );

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  return (
    <div className="space-y-4">
      {/* Search + Sort bar */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts..."
            className="pl-9 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9 text-sm"
          />
        </div>
        <div className="flex gap-1">
          {(["name", "company", "type", "created"] as SortField[]).map((f) => (
            <Button
              key={f}
              variant="outline"
              size="sm"
              onClick={() => toggleSort(f)}
              className={`text-xs border-slate-700 ${
                sortField === f ? "text-blue-400 border-blue-600" : "text-slate-400 hover:bg-slate-800"
              }`}
            >
              {f === "created" ? "Date" : f.charAt(0).toUpperCase() + f.slice(1)}
              {sortField === f && (
                <ArrowUpDown className="h-3 w-3 ml-1" />
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Type filter */}
      <div className="flex gap-2 flex-wrap">
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("all")}
          className={
            filter === "all"
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "border-slate-700 text-slate-400 hover:bg-slate-800"
          }
        >
          All ({contacts.length})
        </Button>
        {CONTACT_TYPES.map((t) => {
          const count = countByType[t];
          if (count === 0) return null;
          return (
            <Button
              key={t}
              variant={filter === t ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(t)}
              className={
                filter === t
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "border-slate-700 text-slate-400 hover:bg-slate-800"
              }
            >
              {CONTACT_TYPE_LABELS[t]} ({count})
            </Button>
          );
        })}
      </div>

      {/* Contact cards */}
      <div className="grid gap-3">
        {filtered.map((contact) => (
          <Card
            key={contact.id}
            className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors"
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-medium text-white truncate">
                      {getContactDisplayName(contact)}
                    </h3>
                    <Badge
                      variant="outline"
                      className="text-xs border-slate-600 text-slate-400 shrink-0"
                    >
                      {CONTACT_TYPE_LABELS[contact.type]}
                    </Badge>
                    {(contact.tags || []).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-600/20 text-blue-400 shrink-0"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {contact.company && (
                    <div className="flex items-center gap-1 text-xs text-slate-400 mb-2">
                      <Building2 className="h-3 w-3" />
                      {contact.company}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                    {contact.email && (
                      <a href={`mailto:${contact.email}`} className="flex items-center gap-1 hover:text-blue-400">
                        <Mail className="h-3 w-3" />
                        {contact.email}
                      </a>
                    )}
                    {(contact.phones?.length > 0 ? contact.phones : contact.phone ? [{ number: contact.phone, label: "mobile" }] : []).map((p, i) => (
                      <a key={i} href={`tel:${p.number}`} className="flex items-center gap-1 hover:text-blue-400">
                        <Phone className="h-3 w-3" />
                        {p.number}
                        <span className="text-slate-600">({p.label})</span>
                      </a>
                    ))}
                    {contact.website && (
                      <a href={contact.website.startsWith("http") ? contact.website : `https://${contact.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-blue-400">
                        <Globe className="h-3 w-3" />
                        {contact.website.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </div>

                  {contact.notes && (
                    <p className="text-xs text-slate-500 mt-2 line-clamp-1">
                      {contact.notes}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-500">
                    {contact.deal_ids.length} deal
                    {contact.deal_ids.length !== 1 ? "s" : ""}
                  </span>
                  <button
                    onClick={() => setEditingContact(contact)}
                    className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-blue-400 transition-colors"
                    title="Edit contact"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {filtered.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-8">
            No contacts match this filter.
          </p>
        )}
      </div>

      {/* Edit dialog */}
      {editingContact && (
        <EditContactDialog
          contact={editingContact}
          open={!!editingContact}
          onClose={() => setEditingContact(null)}
        />
      )}
    </div>
  );
}
