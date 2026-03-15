"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, type ContactType } from "@/lib/constants";
import { Mail, Phone, Building2 } from "lucide-react";
import type { Contact } from "@/lib/validations";

export function ContactList({ contacts }: { contacts: Contact[] }) {
  const [filter, setFilter] = useState<ContactType | "all">("all");

  const filtered =
    filter === "all" ? contacts : contacts.filter((c) => c.type === filter);

  const countByType = CONTACT_TYPES.reduce(
    (acc, t) => {
      acc[t] = contacts.filter((c) => c.type === t).length;
      return acc;
    },
    {} as Record<ContactType, number>
  );

  return (
    <div className="space-y-4">
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
                      {contact.name}
                    </h3>
                    <Badge
                      variant="outline"
                      className="text-xs border-slate-600 text-slate-400 shrink-0"
                    >
                      {CONTACT_TYPE_LABELS[contact.type]}
                    </Badge>
                  </div>

                  {contact.company && (
                    <div className="flex items-center gap-1 text-xs text-slate-400 mb-2">
                      <Building2 className="h-3 w-3" />
                      {contact.company}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {contact.email}
                      </span>
                    )}
                    {contact.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {contact.phone}
                      </span>
                    )}
                  </div>

                  {contact.notes && (
                    <p className="text-xs text-slate-500 mt-2 line-clamp-1">
                      {contact.notes}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <span className="text-xs text-slate-500">
                    {contact.deal_ids.length} deal
                    {contact.deal_ids.length !== 1 ? "s" : ""}
                  </span>
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
    </div>
  );
}
