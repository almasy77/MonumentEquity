import { Briefcase } from "lucide-react";
import { ensureSeedVendors, listVendors } from "@/lib/vendor-store";
import { VendorList } from "@/components/vendors/vendor-list";
import { VendorFormDialog } from "@/components/vendors/vendor-form-dialog";
import type { Vendor } from "@/lib/vendors";

// Read Redis per request. Without this Next prerenders the page at build time,
// which would freeze the list and run the one-time seed during the build.
export const dynamic = "force-dynamic";

async function getVendors(): Promise<Vendor[]> {
  try {
    await ensureSeedVendors();
    return await listVendors();
  } catch {
    return [];
  }
}

export default async function VendorsPage() {
  const vendors = await getVendors();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Vendors</h1>
          <p className="text-slate-400 text-sm mt-1">
            Service providers by deal stage: cost segregation, lenders, inspectors, attorneys and more
          </p>
        </div>
        <VendorFormDialog />
      </div>

      {vendors.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-16">
          <Briefcase className="h-12 w-12 text-slate-600 mb-3" />
          <h3 className="text-lg font-medium text-slate-300">No vendors yet</h3>
          <p className="text-slate-500 text-sm mt-1 max-w-sm">
            Add the firms you use so they surface on deals at the right stage.
          </p>
        </div>
      ) : (
        <VendorList vendors={vendors} />
      )}
    </div>
  );
}
