"use client";

/**
 * Importar o histórico do WhatsApp de UM número — só para administradores.
 *
 * O que esta tela promete, e o que ela nunca faz: importa as conversas que
 * aconteceram ANTES da primeira conexão do número, como registro. Nada é
 * respondido nem enviado — mensagem importada não acorda IA, follow-up,
 * automação nem campanha (migration 0561). Conversa nova entra FECHADA.
 *
 * Se o WhatsApp não guarda histórico (Store desligado), a importação falha com
 * a explicação; esta tela não oferece ligar o Store nem reconectar o número —
 * isso é decisão de quem opera a instalação.
 */
import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import {
  JANELA_MAXIMA_DIAS,
  JANELA_PADRAO_DIAS,
  type ReciboDaImportacao,
} from "@/lib/channels/historico/pedido";

const VIVOS = new Set(["pendente", "em_andamento"]);

/** Só o que tem forma de recibo — a resposta é de fora, e lixo não vira tela. */
function recibosDe(valor: unknown): ReciboDaImportacao[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter(
    (r): r is ReciboDaImportacao =>
      typeof r === "object" && r !== null && typeof (r as { id?: unknown }).id === "string" &&
      typeof (r as { status?: unknown }).status === "string",
  );
}

/** O motivo técnico do banco/leitor, dito para quem administra. */
function explicarFalha(motivo: string | null, t: (s: string) => string): string {
  switch (motivo) {
    case "store_desligado":
      return t("Este número não guarda o histórico no servidor do WhatsApp (o armazenamento de conversas está desligado). Peça a quem administra a instalação para ativá-lo — isso exige conectar o número de novo.");
    case "sessao_sem_primeira_conexao":
      return t("Este número ainda não foi conectado.");
    case "chave_recusada":
      return t("O servidor do WhatsApp recusou a chave de acesso desta instalação.");
    case "sessao_desconhecida":
      return t("O servidor do WhatsApp não reconhece este número. Ele pode ter sido desconectado.");
    default:
      return t("A importação parou por um erro inesperado. O que já foi importado continua salvo.");
  }
}

export function ChannelHistoryImport({ channelId }: { channelId: string }) {
  const t = useT();
  const [aberto, setAberto] = useState(false);

  // Quem decide se a pessoa é administradora é o SERVIDOR: a rota responde 403
  // a quem não é, e então este painel simplesmente não aparece. Não há uma
  // segunda régua de papel na tela para divergir da primeira.
  const query = useQuery({
    queryKey: ["channel-history-imports", channelId],
    queryFn: () =>
      apiClient.get<{ data: unknown }>(`/api/v1/channel-sessions/${channelId}/history-imports`),
    retry: false,
    // Enquanto há importação viva, o progresso se atualiza sozinho.
    refetchInterval: (q) => (recibosDe(q.state.data?.data).some((r) => VIVOS.has(r.status)) ? 5_000 : false),
  });

  if (!query.isSuccess) return null;
  const ultimo = recibosDe(query.data?.data)[0];

  return (
    <div className="flex flex-col items-start gap-2" data-testid="historico-do-whatsapp">
      {ultimo && <ResumoDoRecibo recibo={ultimo} channelId={channelId} />}
      {!ultimo || !VIVOS.has(ultimo.status) ? (
        <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
          {t("Importar histórico")}
        </Button>
      ) : null}
      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("Importar o histórico do WhatsApp")}</SheetTitle>
            <SheetDescription>
              {t("Traz para o CRM as conversas que este número teve antes de ser conectado, só como registro.")}
            </SheetDescription>
          </SheetHeader>
          {aberto && <FormularioDeImportacao channelId={channelId} onFechar={() => setAberto(false)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ResumoDoRecibo({ recibo, channelId }: { recibo: ReciboDaImportacao; channelId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [cancelando, setCancelando] = useState(false);
  const vivo = VIVOS.has(recibo.status);
  const rotulo: Record<ReciboDaImportacao["status"], string> = {
    pendente: t("Histórico: na fila"),
    em_andamento: t("Histórico: importando"),
    concluida: t("Histórico importado"),
    falhou: t("Histórico: importação falhou"),
    cancelada: t("Histórico: importação cancelada"),
  };

  async function cancelar() {
    setCancelando(true);
    try {
      await apiClient.delete(`/api/v1/channel-sessions/${channelId}/history-imports/${recibo.id}`);
      toast.success(t("Importação cancelada. O que já entrou continua salvo."));
      await qc.invalidateQueries({ queryKey: ["channel-history-imports", channelId] });
    } catch {
      toast.error(t("Não foi possível cancelar agora. Tente de novo."));
    } finally {
      setCancelando(false);
    }
  }

  return (
    <div className="flex flex-col gap-1" role="status">
      <Badge variant={recibo.status === "falhou" ? "warning" : "neutral"}>{rotulo[recibo.status]}</Badge>
      <p className="text-xs text-muted-foreground">
        {recibo.conversas_total !== null && vivo
          ? `${recibo.conversas_processadas}/${recibo.conversas_total} ${t("conversas lidas")} · `
          : ""}
        {`${recibo.mensagens_importadas} ${t("mensagens importadas")}`}
        {recibo.mensagens_duplicadas > 0 ? ` · ${recibo.mensagens_duplicadas} ${t("já estavam no CRM")}` : ""}
      </p>
      {recibo.status === "falhou" && (
        <p className="text-xs text-muted-foreground">{explicarFalha(recibo.motivo_falha, t)}</p>
      )}
      {vivo && (
        <Button variant="ghost" size="sm" disabled={cancelando} onClick={() => void cancelar()}>
          {t("Cancelar importação")}
        </Button>
      )}
    </div>
  );
}

function FormularioDeImportacao({ channelId, onFechar }: { channelId: string; onFechar: () => void }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const [dias, setDias] = useState(String(JANELA_PADRAO_DIAS));
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function pedir() {
    const n = Number(dias);
    if (!Number.isInteger(n) || n < 1 || n > JANELA_MAXIMA_DIAS) {
      setErro(t("Escolha um número de dias entre 1 e 730."));
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await apiClient.post(`/api/v1/channel-sessions/${channelId}/history-imports`, { janela_dias: n });
      toast.success(t("Importação na fila. O progresso aparece no cartão do número."));
      await qc.invalidateQueries({ queryKey: ["channel-history-imports", channelId] });
      onFechar();
    } catch (e) {
      const codigo = (e as { code?: string }).code;
      setErro(
        codigo === "importacao_ja_em_andamento"
          ? t("Já existe uma importação em andamento para este número.")
          : codigo === "sessao_sem_primeira_conexao"
            ? t("Este número ainda não foi conectado.")
            : t("Não foi possível pedir a importação agora. Tente de novo."),
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
        <li>{t("Nada é respondido nem enviado. Mensagem importada não aciona IA, follow-up, automação nem campanha.")}</li>
        <li>{t("Conversas que não existiam no CRM entram fechadas: não aparecem na Fila nem são distribuídas.")}</li>
        <li>{t("Fotos, áudios e documentos entram só como registro, sem o arquivo.")}</li>
        <li>{t("Contatos que pediram exclusão dos dados (LGPD) não voltam.")}</li>
      </ul>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-dias`}>{t("Quantos dias antes da conexão do número")}</Label>
        <Input
          id={`${id}-dias`}
          inputMode="numeric"
          value={dias}
          onChange={(e) => setDias(e.target.value)}
          aria-describedby={`${id}-dias-ajuda`}
        />
        <p id={`${id}-dias-ajuda`} className="text-xs text-muted-foreground">
          {t("O padrão é 90 dias. Quanto maior o período, mais dados pessoais antigos entram no CRM.")}
        </p>
        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onFechar} disabled={enviando}>
          {t("Voltar")}
        </Button>
        <Button onClick={() => void pedir()} disabled={enviando}>
          {enviando ? t("Pedindo…") : t("Importar histórico")}
        </Button>
      </div>
    </div>
  );
}
