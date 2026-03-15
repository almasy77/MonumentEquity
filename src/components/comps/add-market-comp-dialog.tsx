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

export function AddMarketCompDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("NC");
  const [zip, setZip] = useState("");
  const [units, setUnits] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [capRate, setCapRate] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");

  function resetForm() {
    setAddress(""); setCity(""); setState("NC"); setZip("");
    setUnits(""); setSalePrice(""); setSaleDate(""); setCapRate("");
    setYearBuilt(""); setPropertyType(""); setSource(""); setNotes("");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/comps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          city,
          state,
          zip: zip || undefined,
          units: parseInt(units),
          sale_price: parseFloat(salePrice),
          sale_date: saleDate,
          cap_rate: capRate ? parseFloat(capRate) / 100 : undefined,
          year_built: yearBuilt ? parseInt(yearBuilt) : undefined,
          property_type: propertyType || undefined,
          source: source || undefined,
          notes: notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create comp");
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
        render={<Button className="bg-blue-600 hover:bg-blue-700 text-white" />}
      >
        <Plus className="h-4 w-4 mr-2" /> Market Comp
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Add Market Comp</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label className="text-slate-300">Address *</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} required
              className="bg-slate-800 border-slate-700 text-white" placeholder="123 Main St" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-slate-300">City *</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} required
                className="bg-slate-800 border-slate-700 text-white" placeholder="Durham" />
            </div>
            <div>
              <Label className="text-slate-300">State *</Label>
              <Input value={state} onChange={(e) => setState(e.target.value)} required
                className="bg-slate-800 border-slate-700 text-white" placeholder="NC" />
            </div>
            <div>
              <Label className="text-slate-300">ZIP</Label>
              <Input value={zip} onChange={(e) => setZip(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white" placeholder="27701" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300">Units *</Label>
              <Input type="number" value={units} onChange={(e) => setUnits(e.target.value)} required min="1"
                className="bg-slate-800 border-slate-700 text-white" placeholder="24" />
            </div>
            <div>
              <Label className="text-slate-300">Sale Price *</Label>
              <Input type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} required min="0"
                className="bg-slate-800 border-slate-700 text-white" placeholder="2500000" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300">Sale Date *</Label>
              <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} required
                className="bg-slate-800 border-slate-700 text-white" />
            </div>
            <div>
              <Label className="text-slate-300">Cap Rate (%)</Label>
              <Input type="number" value={capRate} onChange={(e) => setCapRate(e.target.value)} step="0.1"
                className="bg-slate-800 border-slate-700 text-white" placeholder="6.5" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300">Year Built</Label>
              <Input type="number" value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white" placeholder="1985" />
            </div>
            <div>
              <Label className="text-slate-300">Property Type</Label>
              <Input value={propertyType} onChange={(e) => setPropertyType(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white" placeholder="Garden-Style" />
            </div>
          </div>

          <div>
            <Label className="text-slate-300">Source</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white" placeholder="CoStar, County Records..." />
          </div>

          <div>
            <Label className="text-slate-300">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[60px]"
              placeholder="Condition, renovations, buyer..." />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}
              className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</Button>
            <Button type="submit" disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Comp"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
