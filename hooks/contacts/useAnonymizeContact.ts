"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { LgpdAnonymizeInput } from "@/lib/schemas/contacts";

interface AnonymizeResponse {
  data: {
    contact_id: string;
    anonymized_at: string | null;
    // "resumed": o contato já estava anonimizado, mas leads/atividades ainda
    // não — a chamada completou o que faltava. Antes disto voltava
    // "already_anonymized" mesmo tendo feito trabalho, e o diálogo mostrava a
    // frase que descreve exatamente o defeito ("Contato já estava
    // anonimizado."), sem dizer que algo tinha sido corrigido agora.
    action: "anonymized" | "already_anonymized" | "resumed";
    redacted_lead_ids: string[];
    redacted_activities: number;
  };
}

export function useAnonymizeContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LgpdAnonymizeInput) =>
      apiClient.post<AnonymizeResponse>("/api/v1/lgpd/anonymize", input),
    onError: showApiError,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["contact", vars.contact_id] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
