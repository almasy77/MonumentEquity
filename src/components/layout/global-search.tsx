"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Building2, Users, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface SearchResult {
  type: "deal" | "contact";
  id: string;
  title: string;
  subtitle: string;
}

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setSelectedIndex(0);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 250);
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  function navigate(result: SearchResult) {
    setOpen(false);
    setQuery("");
    if (result.type === "deal") {
      router.push(`/deals/${result.id}`);
    } else {
      router.push(`/contacts`);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      navigate(results[selectedIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search deals, contacts... (⌘K)"
          className="pl-9 pr-8 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 h-9 text-sm"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && query.length >= 2 && (
        <div className="absolute top-full mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {loading && results.length === 0 && (
            <div className="p-3 text-sm text-slate-500 text-center">Searching...</div>
          )}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div className="p-3 text-sm text-slate-500 text-center">No results found</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => navigate(r)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                i === selectedIndex ? "bg-slate-800" : "hover:bg-slate-800/50"
              }`}
            >
              {r.type === "deal" ? (
                <Building2 className="h-4 w-4 text-blue-400 shrink-0" />
              ) : (
                <Users className="h-4 w-4 text-green-400 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-white truncate">{r.title}</p>
                <p className="text-xs text-slate-500 truncate">{r.subtitle}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
