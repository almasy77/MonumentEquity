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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Loader2, Link as LinkIcon } from "lucide-react";
import { DEAL_SOURCES } from "@/lib/constants";

export function AddDealDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Manual form state
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("NC");
  const [zip, setZip] = useState("");
  const [units, setUnits] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [bidPrice, setBidPrice] = useState("");
  const [source, setSource] = useState<string>("");
  const [yearBuilt, setYearBuilt] = useState("");
  const [marketNotes, setMarketNotes] = useState("");

  // URL import state
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

  function resetForm() {
    setAddress("");
    setCity("");
    setState("NC");
    setZip("");
    setUnits("");
    setAskingPrice("");
    setBidPrice("");
    setSource("");
    setYearBuilt("");
    setMarketNotes("");
    setImportUrl("");
    setError("");
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          city,
          state,
          zip: zip || undefined,
          units: parseInt(units),
          asking_price: parseFloat(askingPrice),
          bid_price: bidPrice ? parseFloat(bidPrice) : undefined,
          source,
          year_built: yearBuilt ? parseInt(yearBuilt) : undefined,
          market_notes: marketNotes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create deal");
      }

      const deal = await res.json();
      resetForm();
      setOpen(false);
      router.refresh();
      router.push(`/deals/${deal.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleUrlImport() {
    if (!importUrl) return;
    setImporting(true);
    setError("");

    try {
      const res = await fetch("/api/deals/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to import from URL");
      }

      const extracted = await res.json();
      // Pre-fill the manual form with extracted data
      if (extracted.address) setAddress(extracted.address);
      if (extracted.city) setCity(extracted.city);
      if (extracted.state) setState(extracted.state);
      if (extracted.zip) setZip(extracted.zip);
      if (extracted.units) setUnits(String(extracted.units));
      if (extracted.asking_price) setAskingPrice(String(extracted.asking_price));
      if (extracted.year_built) setYearBuilt(String(extracted.year_built));
      if (extracted.market_notes) setMarketNotes(extracted.market_notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed. Please enter details manually.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger
        render={
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" />
        }
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Deal
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Add New Deal</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="manual" className="mt-2">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="manual" className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400">
              Manual Entry
            </TabsTrigger>
            <TabsTrigger value="url" className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400">
              <LinkIcon className="h-3 w-3 mr-1" /> Import URL
            </TabsTrigger>
          </TabsList>

          <TabsContent value="url" className="mt-4">
            <div className="space-y-3">
              <Label className="text-slate-300">Listing URL</Label>
              <div className="flex gap-2">
                <Input
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://www.loopnet.com/listing/..."
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
                <Button
                  onClick={handleUrlImport}
                  disabled={importing || !importUrl}
                  className="bg-blue-600 hover:bg-blue-700 shrink-0"
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Extract"}
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Paste a listing URL to auto-fill property details. Review and edit before saving.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="manual" className="mt-0">
            {/* Form renders below for both tabs */}
          </TabsContent>
        </Tabs>

        <form onSubmit={handleManualSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 gap-4">
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
                <Label className="text-slate-300">Year Built</Label>
                <Input type="number" value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white" placeholder="1985" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300">Asking Price *</Label>
                <Input type="number" value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} required min="0"
                  className="bg-slate-800 border-slate-700 text-white" placeholder="2500000" />
              </div>
              <div>
                <Label className="text-slate-300">Bid Price</Label>
                <Input type="number" value={bidPrice} onChange={(e) => setBidPrice(e.target.value)} min="0"
                  className="bg-slate-800 border-slate-700 text-white" placeholder="2300000" />
              </div>
            </div>

            <div>
              <Label className="text-slate-300">Source *</Label>
              <Select value={source} onValueChange={(v) => setSource(v ?? "")} required>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue placeholder="Select source..." />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {DEAL_SOURCES.map((s) => (
                    <SelectItem key={s} value={s} className="text-white hover:bg-slate-700">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-slate-300">Market Notes</Label>
              <Textarea value={marketNotes} onChange={(e) => setMarketNotes(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[60px]"
                placeholder="Initial impressions, broker notes..." />
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}
              className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800">
              Cancel
            </Button>
            <Button type="submit" disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Deal"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
