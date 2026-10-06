"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { format } from "date-fns";
import { useT } from "@/hooks/i18n/useT";
import { Note as NoteIcon, Trash } from "@/lib/ui/icons";
import type { Note } from "@/lib/types/messaging";

import { partesDoCorpo } from "@/lib/notifications/mentions";
interface Props {
  note: Note;
  onDelete?: () => void;
}

/** Onda 5.2: nota interna inline no thread — nunca vai ao cliente, destaque âmbar (token `warning`). */
export function NoteCard({ note, onDelete }: Props) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const time = format(new Date(note.created_at), "HH:mm", { locale: localeDaData });

  return (
    <div className="group flex w-full min-w-0 justify-center px-4 py-1">
      <div className="max-w-[85%] min-w-0 rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-warning-fg shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold opacity-80">
            <NoteIcon size={12} weight="fill" aria-hidden />
            <span>{note.created_by_name ?? t("Alguém")}</span>
            <span aria-hidden>·</span>
            <span>{t("Nota interna · só o time vê")}</span>
          </div>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              aria-label={t("Excluir nota")}
            >
              <Trash size={12} weight="bold" />
            </button>
          )}
        </div>
        {/* Nota só de anexo (imagem colada sem legenda) chega com `body` vazio:
            renderizar o `<p>` assim mesmo deixaria um parágrafo fantasma de
            altura nula entre o arquivo e a hora.

            O corpo é partido por `partesDoCorpo`: a menção gravada pelo
            autocompletar (#2372) sai daqui como `@Ana Lima` realçada, e não
            como `@[Ana Lima](mencao:2f9c…)` — o token é coisa de banco. O nome
            vem do próprio corpo, sem ir buscar cadastro em lugar nenhum. */}
        {note.body && (
          <p className="mt-1 whitespace-pre-wrap wrap-anywhere leading-snug">
            {partesDoCorpo(note.body).map((parte, i) =>
              parte.mencao ? (
                <span key={i} className="rounded-sm bg-warning/25 px-0.5 font-semibold">
                  {`@${parte.mencao.nome}`}
                </span>
              ) : (
                <span key={i}>{parte.texto}</span>
              ),
            )}
          </p>
        )}
        <div className="mt-1 text-right text-[10px] opacity-70">{time}</div>
      </div>
    </div>
  );
}
