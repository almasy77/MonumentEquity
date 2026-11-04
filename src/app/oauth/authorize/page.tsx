import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Building2, ShieldCheck, ShieldAlert } from "lucide-react";
import { mcpDisabled } from "@/lib/mcp/oauth-config";
import { signAuthorizeParams, validateAuthorizeRequest } from "@/lib/mcp/authorize-request";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// OAuth authorization endpoint (consent screen). This route is public in proxy.ts so it
// can send an unauthenticated visitor to /login WITH the full authorize query preserved.
export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;

  if (mcpDisabled()) return <Shell title="Connector disabled" tone="error" body="The Claude connector is turned off for this app." />;

  const v = await validateAuthorizeRequest(raw);
  if (!v.ok) return <Shell title="Can't connect" tone="error" body={v.description} />;

  const session = await auth();
  if (!session?.user?.id) {
    const qs = new URLSearchParams();
    for (const [key, val] of Object.entries(raw)) {
      const one = Array.isArray(val) ? val[0] : val;
      if (one !== undefined) qs.set(key, one);
    }
    redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`);
  }

  const { request, sig } = signAuthorizeParams(session.user.id, v.params);
  const redirectHost = new URL(v.params.redirect_uri).host;
  const readOnly = session.user.role === "viewer";

  return (
    <Shell title={`Connect ${v.client.client_name} to Monument Equity`} tone="ok">
      <p className="text-slate-300 text-sm">
        Signed in as <span className="text-white font-medium">{session.user.email}</span>. Approving lets{" "}
        <span className="text-white font-medium">{v.client.client_name}</span> ({redirectHost}) act as you in this app:
      </p>
      <ul className="text-sm text-slate-300 list-disc pl-5 space-y-1 my-4">
        <li>Read your deals, scenarios and activity</li>
        {readOnly ? (
          <li>Your account is read-only, so Claude will not be able to change anything</li>
        ) : (
          <>
            <li>Create deals and scenarios, and edit deal fields and scenario assumptions</li>
            <li>Pass or reactivate deals</li>
          </>
        )}
        <li className="text-slate-400">It can never delete anything or mark a deal dead</li>
      </ul>
      <p className="text-xs text-slate-500 mb-4">You can revoke access any time in Settings → General → Connected apps.</p>
      <form method="POST" action="/api/oauth/authorize" className="flex gap-3">
        <input type="hidden" name="request" value={request} />
        <input type="hidden" name="sig" value={sig} />
        <Button type="submit" name="decision" value="approve" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">
          Approve
        </Button>
        <Button type="submit" name="decision" value="deny" variant="outline" className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800">
          Deny
        </Button>
      </form>
    </Shell>
  );
}

function Shell({
  title,
  body,
  tone,
  children,
}: {
  title: string;
  body?: string;
  tone: "ok" | "error";
  children?: React.ReactNode;
}) {
  const Icon = tone === "ok" ? ShieldCheck : ShieldAlert;
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-md bg-slate-900 border-slate-800">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-white flex items-center justify-center gap-2">
            <Icon className={`h-5 w-5 ${tone === "ok" ? "text-emerald-400" : "text-red-400"}`} />
            {title}
          </h1>
        </CardHeader>
        <CardContent>
          {body && <p className="text-slate-300 text-sm text-center">{body}</p>}
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
