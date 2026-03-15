"use client";

import { useSession } from "next-auth/react";

/**
 * Renders children only if the current user is an admin.
 * Use this to hide UI elements (buttons, actions) from VA users.
 */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  if (session?.user?.role !== "admin") return null;
  return <>{children}</>;
}
