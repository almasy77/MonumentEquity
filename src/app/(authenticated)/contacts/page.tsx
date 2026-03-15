import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Users } from "lucide-react";

export default function ContactsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Contacts</h1>
          <p className="text-slate-400 text-sm mt-1">
            Brokers, lenders, attorneys, and other key relationships
          </p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Contact
        </Button>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-8">
          <div className="flex flex-col items-center justify-center text-center">
            <Users className="h-12 w-12 text-slate-600 mb-3" />
            <h3 className="text-lg font-medium text-slate-300">
              No contacts yet
            </h3>
            <p className="text-slate-500 text-sm mt-1 max-w-sm">
              Add brokers, lenders, and other contacts to track relationships
              across deals.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
