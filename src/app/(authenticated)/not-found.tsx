import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex items-center justify-center py-20">
      <Card className="bg-slate-900 border-slate-800 max-w-md">
        <CardContent className="p-8 text-center">
          <SearchX className="h-10 w-10 text-slate-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-white mb-2">Not Found</h2>
          <p className="text-sm text-slate-400 mb-4">
            The page you&apos;re looking for doesn&apos;t exist.
          </p>
          <Link href="/">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white">
              Back to Dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
