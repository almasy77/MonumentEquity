import { auth } from "@/lib/auth";

/**
 * Check if the current user has admin role.
 * Returns true if admin, false if VA or unauthenticated.
 */
export async function isAdmin(): Promise<boolean> {
  const session = await auth();
  return session?.user?.role === "admin";
}

/**
 * VA-restricted actions that require admin role:
 * - Delete deals, contacts, comps, tasks
 * - Change deal stages
 * - Modify settings (default assumptions, templates)
 * - Export to Excel
 * - Create share links
 */
export const VA_RESTRICTED_ACTIONS = [
  "delete",
  "change_stage",
  "modify_settings",
  "export",
  "share",
] as const;
