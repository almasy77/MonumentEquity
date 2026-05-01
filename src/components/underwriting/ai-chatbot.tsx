"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Send, X, Loader2, MessageSquare } from "lucide-react";
import { useAiChatbot } from "./ai-chatbot-context";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  success?: boolean;
}

export function AiChatbot() {
  const { scenarioId, onAiResult } = useAiChatbot();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const canSend = !!scenarioId && !!onAiResult;

  async function handleSend() {
    if (!input.trim() || processing || !scenarioId || !onAiResult) return;
    const instruction = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: instruction }]);
    setProcessing(true);

    try {
      const res = await fetch(`/api/scenarios/${scenarioId}/ai-assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });

      if (res.ok) {
        const data = await res.json();
        onAiResult(data);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Done — applied "${instruction}"`, success: true },
        ]);
      } else {
        const err = await res.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: err.error || "Failed to apply changes", success: false },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: err instanceof Error ? err.message : "Request failed", success: false },
      ]);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/40 flex items-center justify-center transition-all hover:scale-105"
      >
        {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden" style={{ maxHeight: "min(500px, calc(100vh - 8rem))" }}>
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900/80 shrink-0">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-medium text-white flex-1">AI Assistant</span>
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <MessageSquare className="h-8 w-8 text-slate-700 mx-auto mb-3" />
                {canSend ? (
                  <>
                    <p className="text-sm text-slate-500 mb-1">Ask AI to modify assumptions</p>
                    <p className="text-xs text-slate-600">
                      Try: &ldquo;set all reno premiums to $0&rdquo; or &ldquo;change vacancy to 8%&rdquo;
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-slate-500 mb-1">AI Assistant</p>
                    <p className="text-xs text-slate-600">
                      Open a deal&apos;s underwriting tab and select a scenario to start modifying assumptions with AI.
                    </p>
                  </>
                )}
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-purple-600 text-white"
                      : msg.success
                        ? "bg-green-900/30 border border-green-800/50 text-green-300"
                        : "bg-red-900/30 border border-red-800/50 text-red-300"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {processing && (
              <div className="flex justify-start">
                <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-400 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-800 p-3 shrink-0">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                placeholder={canSend ? "Type an instruction..." : "Select a scenario to use AI..."}
                disabled={processing || !canSend}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
              />
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!input.trim() || processing || !canSend}
                className="bg-purple-600 hover:bg-purple-500 text-white h-9 px-3"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
