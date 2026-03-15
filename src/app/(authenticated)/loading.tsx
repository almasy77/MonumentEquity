import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
    </div>
  );
}
