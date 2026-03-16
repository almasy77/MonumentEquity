import type { Contact } from "./validations";

export function getContactDisplayName(contact: Contact): string {
  if (contact.first_name) {
    const parts = [contact.first_name];
    if (contact.nickname) parts.push(`"${contact.nickname}"`);
    if (contact.last_name) parts.push(contact.last_name);
    return parts.join(" ");
  }
  // Legacy fallback
  return (contact as unknown as Record<string, unknown>).name as string || "Unnamed";
}

export function getContactSortName(contact: Contact): string {
  return `${contact.last_name || ""} ${contact.first_name || ""}`.trim().toLowerCase();
}
