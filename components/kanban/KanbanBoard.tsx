"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { useT } from "@/hooks/i18n/useT";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CaretLeft, CaretRight } from "@/lib/ui/icons";
import { useBoard } from "@/hooks/kanban/useBoard";
import { useMoveCard } from "@/hooks/kanban/useMoveCard";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAtRiskLeads } from "@/hooks/leads/useAtRiskLeads";
import { useReactivations } from "@/hooks/leads/useReactivations";
import { midpoint } from "@/lib/kanban/fractional-indexing";
import type { Lead } from "@/lib/types/leads";
import type { Pipeline, Stage } from "@/lib/kanban/types";
import { StageColumn } from "./StageColumn";
import { LeadDossier } from "./LeadDossier";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";

/**
 * As colunas de estágio rolam na horizontal (`overflow-x-auto`) sem nenhum
 * indício visual — quem tem mais estágios do que cabem na tela não descobre
 * sozinho que dá pra arrastar pro lado. As setas só aparecem quando há
 * overflow real (`canScrollLeft`/`canScrollRight`): um board com poucos
 * estágios que já cabem inteiros na viewport nunca as mostra.
 */
export function useBoardScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [update]);

  const scrollBy = useCallback((delta: number) => {
    ref.current?.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  return { ref, canScrollLeft, canScrollRight, scrollBy };
}

interface KanbanBoardProps {
  pipelineId: string;
  /** Optional override: if provided, skips internal useBoard fetch. */
  stages?: Stage[];
  leads?: Lead[];
  pipeline?: Pipeline;
  selectedIds?: string[];
  /**
   * Ids que chegaram por evento remoto, quando o board recebe os dados de fora.
   *
   * Quem assina o realtime é quem chama `useBoard` com o pipeline — e nesta
   * página é o _client, não este componente (aqui `useBoard(null)` fica
   * desligado por causa do `useExternal`). Sem esta prop o pulso nasce no lugar
   * certo e morre na fronteira: o dado vem por prop e o sinal ficava para trás.
   */
  pulses?: Map<string, number>;
  onSelectionChange?: (ids: string[]) => void;
  /** Lead a abrir já na montagem (deep link `?lead=` — ver o dossiê abaixo). */
  leadInicial?: string | null;
}

function groupLeadsByStage(stages: Stage[], leads: Lead[]): Map<string, Lead[]> {
  const map = new Map<string, Lead[]>();
  for (const stage of stages) map.set(stage.id, []);
  for (const lead of leads) {
    const bucket = map.get(lead.stage_id);
    if (bucket) bucket.push(lead);
  }
  // Already ordered by position_in_stage at fetch time, but be defensive.
  for (const list of map.values()) {
    list.sort((a, b) => a.position_in_stage - b.position_in_stage);
  }
  return map;
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto p-4">
      {[0, 1, 2].map((c) => (
        <div
          key={c}
          className="flex w-80 shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface-muted/40 p-3"
        >
          <Skeleton className="h-5 w-32" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function KanbanBoard({
  pipelineId,
  stages: stagesProp,
  leads: leadsProp,
  pipeline: pipelineProp,
  selectedIds,
  pulses: pulsesProp,
  onSelectionChange,
  leadInicial,
}: KanbanBoardProps) {
  const t = useT();
  const { ref: scrollRef, canScrollLeft, canScrollRight, scrollBy } = useBoardScroll();
  const useExternal = stagesProp !== undefined && leadsProp !== undefined;
  const queryResult = useBoard(useExternal ? null : pipelineId);
  const moveCard = useMoveCard(pipelineId);
  const { data: members } = useAssignableMembers(true);
  const ownerNames = useMemo(
    () => new Map((members ?? []).map((m) => [m.user_id, m.full_name])),
    [members],
  );
  // Esfriando vem do MESMO radar que alimenta /app/radar — o board não
  // reclassifica nada (contrato §3.3). `em_voo` fica de fora: a IA já prometeu
  // voltar, então não há decisão pendente para o humano.
  const { data: atRisk } = useAtRiskLeads();
  // As propostas vivas vêm da MESMA forma que o risco: uma lista por org, que o
  // card consome sem saber de onde veio. Ver o cabeçalho da rota.
  const { data: propostasVivas } = useReactivations();
  const reactivations = useMemo(() => {
    const m = new Map<string, { proposalId: string; expiresAt: string }>();
    for (const p of propostasVivas ?? []) {
      m.set(p.lead_id, { proposalId: p.proposal_id, expiresAt: p.expires_at });
    }
    return m;
  }, [propostasVivas]);
  const coolingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of atRisk?.items ?? []) {
      if (item.pipeline_id !== pipelineId) continue;
      if (item.risk === "em_risco" || item.risk === "critico") ids.add(item.id);
    }
    return ids;
  }, [atRisk, pipelineId]);
  // A tag canônica do pipeline é a ÚNICA que fica no card (como ponto de 6px);
  // as outras saem para o hover. Já existe em settings — não inventa campo.
  const canonicalTags = useMemo(() => {
    const raw = (pipelineProp ?? queryResult.data?.pipeline)?.settings?.canonical_tags;
    return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
  }, [pipelineProp, queryResult.data?.pipeline]);

  // O dossiê é do BOARD e não da página: ele precisa do lead inteiro e do nome
  // do estágio, que só existem aqui depois do agrupamento.
  //
  // `leadInicial` é o deep link: até aqui o dossiê SÓ abria por clique, então
  // nenhuma outra tela do produto conseguia apontar para um lead específico —
  // o histórico de captação tinha o id e nenhum lugar para levá-lo. Uma vez
  // aberto, o estado local manda (fechar não reabre pela URL).
  const [dossieId, setDossieId] = useState<string | null>(leadInicial ?? null);
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const selectedLeadIds = useMemo(
    () => (selectedIds ? new Set(selectedIds) : internalSelected),
    [selectedIds, internalSelected],
  );

  const data = useExternal
    ? {
        pipeline: pipelineProp ?? ({} as Pipeline),
        stages: stagesProp,
        leads: leadsProp,
      }
    : queryResult.data;
  const isLoading = useExternal ? false : queryResult.isLoading;
  const isError = useExternal ? false : queryResult.isError;
  const error = useExternal ? null : queryResult.error;

  const leadDoDossie = dossieId
    ? (data?.leads.find((l) => l.id === dossieId) ?? null)
    : null;

  const grouped = useMemo(() => {
    if (!data) return null;
    return groupLeadsByStage(data.stages, data.leads);
  }, [data]);

  // Um conjunto por vez, e não um card por vez: o board recebe o resultado do
  // gesto já resolvido pela coluna (um card, um intervalo, a etapa inteira). A
  // versão anterior só sabia alternar UM id, e é por isso que "selecionar tudo"
  // não existia — cada card exigia uma volta pelo estado.
  const handleSelectMany = useCallback(
    (leadIds: string[], marcar: boolean) => {
      const apply = (prev: Set<string>): Set<string> => {
        const next = new Set(prev);
        for (const id of leadIds) {
          if (marcar) next.add(id);
          else next.delete(id);
        }
        return next;
      };
      if (onSelectionChange) {
        onSelectionChange(Array.from(apply(selectedLeadIds)));
      } else {
        setInternalSelected((prev) => apply(prev));
      }
    },
    [onSelectionChange, selectedLeadIds],
  );

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      if (!data || !grouped) return;
      const { source, destination, draggableId } = result;
      if (!destination) return;
      if (
        source.droppableId === destination.droppableId &&
        source.index === destination.index
      ) {
        return;
      }

      const lead = data.leads.find((l) => l.id === draggableId);
      if (!lead) return;

      const destStageId = destination.droppableId;
      const destList = (grouped.get(destStageId) ?? []).filter(
        (l) => l.id !== draggableId,
      );

      const before = destination.index > 0 ? destList[destination.index - 1] : null;
      const after =
        destination.index < destList.length ? destList[destination.index] : null;

      const newPosition = midpoint(
        before?.position_in_stage ?? null,
        after?.position_in_stage ?? null,
      );

      if (Number.isNaN(newPosition)) {
        // Collision — Wave 8 will handle global rebalance. For now, abort silently.
        return;
      }

      moveCard.mutate({
        leadId: lead.id,
        stageId: destStageId,
        positionInStage: newPosition,
        expectedUpdatedAt: lead.updated_at,
      });
    },
    [data, grouped, moveCard],
  );

  if (isLoading) {
    return <BoardSkeleton />;
  }

  if (isError) {
    return (
      <Card className="m-4 p-6 text-sm text-text-muted">
        {t("Falha ao carregar o board.")}
        {error instanceof Error ? ` ${error.message}` : null}
      </Card>
    );
  }

  if (!data || !grouped) {
    return null;
  }

  if (data.stages.length === 0) {
    return (
      <Card className="m-4 p-6 text-sm text-text-muted">
        {t("Nenhum lead nesta pipeline ainda.")}
      </Card>
    );
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="relative h-full min-h-0">
        {/*
         * As colunas (StageColumn) não têm scroll vertical próprio — crescem
         * com a quantidade de leads, e é a PÁGINA inteira que rola. Por isso
         * as setas NÃO se centralizam em `top-1/2` do container (que herda
         * essa altura sem limite: com muitos leads numa coluna, o centro fica
         * bem abaixo da dobra, fora da tela). `top-24` ancora logo abaixo do
         * cabeçalho das colunas — sempre visível na carga inicial, que é
         * quando a maioria decide se vai descobrir o scroll.
         */}
        {canScrollLeft && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={t("Rolar estágios para a esquerda")}
            data-testid="kanban-scroll-left"
            onClick={() => scrollBy(-320)}
            className="absolute left-2 top-24 z-10 rounded-full shadow-md"
          >
            <CaretLeft size={18} />
          </Button>
        )}
        {canScrollRight && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={t("Rolar estágios para a direita")}
            data-testid="kanban-scroll-right"
            onClick={() => scrollBy(320)}
            className="absolute right-2 top-24 z-10 rounded-full shadow-md"
          >
            <CaretRight size={18} />
          </Button>
        )}
        <div ref={scrollRef} className="flex h-full gap-3 overflow-x-auto p-4">
          {data.stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              leads={grouped.get(stage.id) ?? []}
              pipelineId={pipelineId}
              ownerNames={ownerNames}
              coolingIds={coolingIds}
              reactivations={reactivations}
              pulses={pulsesProp ?? queryResult.pulses}
              canonicalTags={canonicalTags}
              selectedLeadIds={selectedLeadIds}
              onSelectMany={handleSelectMany}
              onOpen={setDossieId}
            />
          ))}
        </div>
      </div>
      {leadDoDossie && (
        <LeadDossier
          open
          onOpenChange={(v: boolean) => !v && setDossieId(null)}
          lead={leadDoDossie}
          pipelineId={pipelineId}
          fieldDefs={camposDoFunil(data.pipeline.settings ?? null)}
          stageName={
            data.stages.find((s) => s.id === leadDoDossie.stage_id)?.name ?? "—"
          }
          ownerNames={ownerNames}
        />
      )}
    </DragDropContext>
  );
}
