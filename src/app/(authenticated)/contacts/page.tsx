import { getRedis } from "@/lib/db";
import { AddContactDialog } from "@/components/contacts/add-contact-dialog";
import { ContactList } from "@/components/contacts/contact-list";
import { Users } from "lucide-react";
import type { Contact } from "@/lib/validations";

async function getContacts(): Promise<Contact[]> {
  try {
    const redis = getRedis();
    const ids = await redis.zrange("contacts:all", 0, -1, { rev: true });
    if (ids.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`contact:${id}`);
    }
    const results = await pipeline.exec<(Contact | null)[]>();
    return results.filter((r): r is Contact => r !== null);
  } catch {
    return [];
  }
}

export default async function ContactsPage() {
  const contacts = await getContacts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Contacts</h1>
          <p className="text-slate-400 text-sm mt-1">
            Brokers, lenders, attorneys, and other key relationships
          </p>
        </div>
        <AddContactDialog />
      </div>

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-16">
          <Users className="h-12 w-12 text-slate-600 mb-3" />
          <h3 className="text-lg font-medium text-slate-300">
            No contacts yet
          </h3>
          <p className="text-slate-500 text-sm mt-1 max-w-sm">
            Add brokers, lenders, and other contacts to track relationships
            across deals.
          </p>
        </div>
      ) : (
        <ContactList contacts={contacts} />
      )}
    </div>
  );
}
