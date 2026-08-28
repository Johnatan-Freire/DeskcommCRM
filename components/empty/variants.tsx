"use client";

import {
  ChatCircle,
  Kanban,
  UsersThree,
  ListMagnifyingGlass,
  Funnel,
  ArrowsLeftRight,
  Key,
  ClockCounterClockwise,
  GitBranch,
  Users,
} from "@phosphor-icons/react";
// Do barril, e não do `@phosphor-icons/react` que as linhas acima usam: a regra
// (ADR-05) é o barril, e 116 arquivos a seguem. O import de cima é dívida
// anterior a esta feature — replicá-la para ficar "consistente com o arquivo"
// espalharia o problema em vez de parar de crescê-lo.
import { CalendarBlank } from "@/lib/ui/icons";

import { EmptyState, type EmptyStateAction } from "./EmptyState";

interface VariantProps {
  primary?: EmptyStateAction;
  secondary?: EmptyStateAction;
}

export function EmptyInbox({ primary, secondary }: VariantProps = {}) {
  return (
    <EmptyState
      icon={ChatCircle}
      headline="Sem conversas por aqui"
      subcopy="Quando chegarem mensagens, elas aparecem aqui em tempo real."
      primary={primary}
      secondary={secondary}
    />
  );
}

export function EmptyKanban({ primary, secondary }: VariantProps = {}) {
  return (
    <EmptyState
      icon={Kanban}
      headline="Quadro vazio"
      subcopy="Ainda não há nenhum cliente aqui. Assim que a primeira conversa começar, o cartão aparece nesta coluna."
      primary={primary}
      secondary={secondary}
    />
  );
}

export function EmptyContacts({ primary, secondary }: VariantProps = {}) {
  return (
    <EmptyState
      icon={UsersThree}
      headline="Nenhum contato ainda"
      subcopy="Contatos chegam automaticamente via WhatsApp ou Nuvemshop."
      primary={primary}
      secondary={secondary}
    />
  );
}

export function EmptyAudit({ primary, secondary }: VariantProps = {}) {
  return (
    <EmptyState
      icon={ListMagnifyingGlass}
      headline="Sem eventos no período"
      subcopy="Ajuste o filtro de datas ou a busca pra ver eventos."
      primary={primary}
      secondary={secondary}
    />
  );
}

export function EmptyPipeline({ primary, secondary }: VariantProps = {}) {
  return (
    <EmptyState
      icon={GitBranch}
      headline="Nenhum funil ainda"
      subcopy="Um funil é o caminho que o cliente percorre até fechar. Crie o primeiro para ter um quadro."
      primary={primary}
      secondary={secondary}
    />
  );
}

export function EmptyTeam({ primary, secondary }: VariantProps = {}) {
  return (
    <EmptyState
      icon={Users}
      headline="Sem membros no time"
      subcopy="Convide colegas pra atender em conjunto."
      primary={primary}
      secondary={secondary}
    />
  );
}

export function EmptyApiTokens({ primary, secondary }: VariantProps = {}) {
  return (
    <EmptyState
      icon={Key}
      headline="Nenhum token criado"
      subcopy="Tokens permitem integrações server-to-server."
      primary={primary}
      secondary={secondary}
    />
  );
}

export function EmptyTimeline({ primary, secondary }: VariantProps = {}) {
  return (
    <EmptyState
      icon={ClockCounterClockwise}
      headline="Sem atividades registradas"
      subcopy="A timeline mostra mensagens, mudanças de stage e notas."
      primary={primary}
      secondary={secondary}
    />
  );
}

export function EmptyMergeQueue({ primary, secondary }: VariantProps = {}) {
  return (
    <EmptyState
      icon={ArrowsLeftRight}
      headline="Sem candidatos a merge"
      subcopy="Contatos duplicados aparecerão aqui pra revisão."
      primary={primary}
      secondary={secondary}
    />
  );
}

export function EmptyFilterResults({ primary, secondary }: VariantProps = {}) {
  return (
    <EmptyState
      icon={Funnel}
      headline="Nenhum resultado"
      subcopy="Tente ajustar os filtros ou a busca."
      primary={primary}
      secondary={secondary}
    />
  );
}

export function EmptyAgenda({ primary, secondary }: VariantProps = {}) {
  return (
    <EmptyState
      icon={CalendarBlank}
      headline="Sua agenda está livre esta semana"
      // O vazio diz de onde VEM o próximo agendamento, em vez de constatar a
      // ausência. "Nenhum agendamento encontrado" é verdadeiro e inútil: quem
      // acabou de instalar não sabe o que fazer com essa frase.
      subcopy="Agendamentos aparecem aqui quando alguém marca pela tela, quando o agente marca por você, ou quando chegam da agenda do Google conectada."
      primary={primary}
      secondary={secondary}
    />
  );
}
