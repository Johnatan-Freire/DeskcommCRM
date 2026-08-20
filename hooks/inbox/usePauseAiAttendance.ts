"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

interface PauseArgs {
  conversation_id: string;
}

interface PauseResponse {
  data: { paused: boolean };
}

/**
 * Pausa o atendimento automático desta conversa NA HORA — o oposto de
 * useResumeAiAttendance. Sem isto, a única forma de pausar era digitar uma
 * mensagem de verdade (silêncio de 5min, deslizante) ou esperar a própria IA
 * decidir fazer handoff sozinha — nenhum jeito deliberado e instantâneo pela
 * tela.
 */
export function usePauseAiAttendance() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: PauseArgs) =>
      apiClient.post<PauseResponse>(`/api/v1/conversations/${args.conversation_id}/pause-bot`, {}),
    onError: (err) => showApiError(err),
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
    },
  });
}
