"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2 } from "lucide-react";

export function AddRentCompDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [propertyName, setPropertyName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [submarket, setSubmarket] = useState("");
  const [unitType, setUnitType] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [sqft, setSqft] = useState("");
  const [rent, setRent] = useState("");
  const [dateObserved, setDateObserved] = useState("");
  const [source, setSource] = useState("");
  const [amenities, setAmenities] = useState("");
  const [notes, setNotes] = useState("");

  function resetForm() {
    setPropertyName(""); setAddress(""); setCity(""); setSubmarket("");
    setUnitType(""); setBedrooms(""); setBathrooms(""); setSqft("");
    setRent(""); setDateObserved(""); setSource(""); setAmenities("");
    setNotes(""); setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/rent-comps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: propertyName || undefined,
          address,
          city,
          submarket: submarket || undefined,
          unit_type: unitType || undefined,
          bedrooms: bedrooms ? parseInt(bedrooms) : undefined,
          bathrooms: bathrooms ? parseFloat(bathrooms) : undefined,
          square_footage: sqft ? parseInt(sqft) : undefined,
          rent: parseFloat(rent),
          date_observed: dateObserved,
          source: source || undefined,
          amenities: amenities || undefined,
          notes: notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create rent comp");
      }

      resetForm();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger
        render={<Button variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800" />}
      >
        <Plus className="h-4 w-4 mr-2" /> Rent Comp
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Add Rent Comp</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300">Property Name</Label>
              <Input value={propertyName} onChange={(e) => setPropertyName(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white" placeholder="The Pines" />
            </div>
            <div>
              <Label className="text-slate-300">Address *</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} required
                className="bg-slate-800 border-slate-700 text-white" placeholder="456 Oak Ave" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300">City *</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} required
                className="bg-slate-800 border-slate-700 text-white" placeholder="Durham" />
            </div>
            <div>
              <Label className="text-slate-300">Submarket</Label>
              <Input value={submarket} onChange={(e) => setSubmarket(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white" placeholder="Downtown Durham" />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label className="text-slate-300">Unit Type</Label>
              <Input value={unitType} onChange={(e) => setUnitType(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white" placeholder="1BR/1BA" />
            </div>
            <div>
              <Label className="text-slate-300">Beds</Label>
              <Input type="number" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} min="0"
                className="bg-slate-800 border-slate-700 text-white" placeholder="1" />
            </div>
            <div>
              <Label className="text-slate-300">Baths</Label>
              <Input type="number" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} min="0" step="0.5"
                className="bg-slate-800 border-slate-700 text-white" placeholder="1" />
            </div>
            <div>
              <Label className="text-slate-300">Sq Ft</Label>
              <Input type="number" value={sqft} onChange={(e) => setSqft(e.target.value)} min="0"
                className="bg-slate-800 border-slate-700 text-white" placeholder="750" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300">Monthly Rent *</Label>
              <Input type="number" value={rent} onChange={(e) => setRent(e.target.value)} required min="0"
                className="bg-slate-800 border-slate-700 text-white" placeholder="1200" />
            </div>
            <div>
              <Label className="text-slate-300">Date Observed *</Label>
              <Input type="date" value={dateObserved} onChange={(e) => setDateObserved(e.target.value)} required
                className="bg-slate-800 border-slate-700 text-white" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300">Source</Label>
              <Input value={source} onChange={(e) => setSource(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white" placeholder="Apartments.com" />
            </div>
            <div>
              <Label className="text-slate-300">Amenities</Label>
              <Input value={amenities} onChange={(e) => setAmenities(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white" placeholder="W/D, Pool..." />
            </div>
          </div>

          <div>
            <Label className="text-slate-300">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[60px]"
              placeholder="Unit condition, renovated, etc." />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}
              className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</Button>
            <Button type="submit" disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Rent Comp"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
