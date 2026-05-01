"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { Scenario } from "@/lib/validations";
import type { UnderwritingResult } from "@/lib/underwriting";

interface AiChatbotContextValue {
  scenarioId: string | null;
  setScenarioId: (id: string | null) => void;
  onAiResult: ((data: { scenario: Scenario; underwriting: UnderwritingResult }) => void) | null;
  setOnAiResult: (cb: ((data: { scenario: Scenario; underwriting: UnderwritingResult }) => void) | null) => void;
}

const AiChatbotContext = createContext<AiChatbotContextValue>({
  scenarioId: null,
  setScenarioId: () => {},
  onAiResult: null,
  setOnAiResult: () => {},
});

export function AiChatbotProvider({ children }: { children: React.ReactNode }) {
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [onAiResult, setOnAiResultState] = useState<((data: { scenario: Scenario; underwriting: UnderwritingResult }) => void) | null>(null);

  const setOnAiResult = useCallback(
    (cb: ((data: { scenario: Scenario; underwriting: UnderwritingResult }) => void) | null) => {
      setOnAiResultState(() => cb);
    },
    []
  );

  return (
    <AiChatbotContext.Provider value={{ scenarioId, setScenarioId, onAiResult, setOnAiResult }}>
      {children}
    </AiChatbotContext.Provider>
  );
}

export function useAiChatbot() {
  return useContext(AiChatbotContext);
}
