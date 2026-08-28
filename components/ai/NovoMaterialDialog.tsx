"use client";
/**
 * ADICIONAR MATERIAL AO ACERVO.
 *
 * A versão anterior era um diálogo por SLOT: quatro cartões fixos, e o de FAQ
 * abria um textarea. Não havia como escolher o tipo, não havia como enviar
 * arquivo (a rota existia e nenhuma tela a chamava), e não havia uma palavra
 * sobre a chave de que a indexação depende.
 *
 * Três decisões:
 *
 *  1. **O tipo é escolhido primeiro**, porque é ele que muda o que se pede a
 *     seguir. Perguntar "cole o conteúdo" antes de saber se é um PDF é como
 *     pedir o endereço antes de perguntar se a entrega é digital.
 *  2. **Documento aceita arquivo OU texto colado.** Quem tem o PDF envia; quem
 *     tem o texto na cabeça cola. Os dois terminam no mesmo lugar.
 *  3. **A falta de chave é dita ANTES**, com o conserto na própria tela. Subir
 *     um arquivo de 8 MB e só então descobrir que ele não vai ser preparado é a
 *     pior ordem possível.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  TIPOS_DE_FONTE,
  TIPO_DE_FONTE_POR_ID,
  aceitaArquivo,
  ePerguntaEResposta,
  ePreenchidoPorRotina,
  type TipoDeFonteId,
} from "@/lib/ai/rag/tipos-de-fonte";

const EXEMPLO_FAQ = `## Pergunta: Qual o prazo de entrega?
## Resposta: De 2 a 3 dias úteis após a confirmação do pagamento.

## Pergunta: Vocês fazem troca?
## Resposta: Sim, em até 30 dias, com o produto sem uso.`;

const EXEMPLO_DOCUMENTO = `# Política de troca

Aceitamos troca em até 30 dias da entrega, com o produto sem uso e na embalagem
original. O frete de devolução é por nossa conta quando o defeito for de fábrica.`;

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onCriado: () => void;
  /** Quando falso, o diálogo avisa que o material vai ficar esperando. */
  podeIndexar: boolean;
}

export function NovoMaterialDialog({ aberto, onFechar, onCriado, podeIndexar }: Props) {
  const [tipo, setTipo] = useState<TipoDeFonteId>("faq");
  const [nome, setNome] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const meta = TIPO_DE_FONTE_POR_ID.get(tipo);
  const porRotina = ePreenchidoPorRotina(tipo);

  function limpar(): void {
    setNome("");
    setConteudo("");
    setArquivo(null);
    if (inputArquivo.current) inputArquivo.current.value = "";
  }

  async function criar(): Promise<void> {
    const nomeLimpo = nome.trim();
    if (nomeLimpo.length < 2) {
      toast.error("Dê um nome ao material — é assim que você o encontra depois.");
      return;
    }
    if (!arquivo && conteudo.trim().length === 0) {
      toast.error("Envie um arquivo ou cole o conteúdo.");
      return;
    }

    setEnviando(true);
    try {
      if (arquivo) {
        const form = new FormData();
        form.append("file", arquivo);
        form.append("name", nomeLimpo);
        const res = await fetch("/api/v1/ai/knowledge/sources/upload", {
          method: "POST",
          body: form,
        });
        const json = (await res.json()) as { error?: { message?: string } };
        if (!res.ok) {
          toast.error(json.error?.message ?? "Não consegui guardar o arquivo.");
          return;
        }
      } else {
        await apiClient.post("/api/v1/ai/knowledge/sources", {
          source_type: tipo,
          name: nomeLimpo,
          markdown_blob: conteudo,
        });
      }

      toast.success(
        podeIndexar
          ? "Material cadastrado. Estou preparando — em instantes o agente já sabe."
          : "Material cadastrado. Ele fica esperando a chave da OpenAI para ser preparado.",
      );
      limpar();
      onCriado();
      onFechar();
    } catch (err) {
      showApiError(err);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      {/* O CORPO ROLA, O RODAPÉ FICA.
          Sem isto o diálogo cresce até empurrar "Adicionar ao acervo" para fora
          da tela: num monitor de 720px de altura o botão existia e era
          inalcançável — medido pelo e2e, que não conseguiu clicar nele. Um
          formulário cujo botão de enviar não cabe na tela é um formulário que
          não se envia. */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ensinar algo novo ao agente</DialogTitle>
          <DialogDescription>
            Ele consulta este material antes de responder sobre o seu negócio.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Que tipo de material é</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="material-tipos">
              {TIPOS_DE_FONTE.map((t) => {
                const rotina = ePreenchidoPorRotina(t.id);
                const marcado = tipo === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={rotina || enviando}
                    onClick={() => setTipo(t.id)}
                    data-testid={`material-tipo-${t.id}`}
                    className={[
                      "rounded-lg border p-3 text-left text-sm transition",
                      marcado ? "border-accent bg-accent/10" : "border-border hover:bg-surface",
                      rotina ? "cursor-not-allowed opacity-50" : "",
                    ].join(" ")}
                  >
                    <span className="font-medium">{t.rotulo}</span>
                    <span className="mt-1 block text-xs text-text-muted">{t.oQueE}</span>
                  </button>
                );
              })}
            </div>
            {porRotina && meta?.comoChega ? (
              <p className="text-xs text-text-muted">{meta.comoChega}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="material-nome">Nome do material</Label>
            <Input
              id="material-nome"
              data-testid="material-nome"
              placeholder={tipo === "faq" ? "Perguntas frequentes da loja" : "Política de troca"}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={enviando || porRotina}
            />
          </div>

          {aceitaArquivo(tipo) ? (
            <div className="space-y-2">
              <Label htmlFor="material-arquivo">Arquivo (opcional)</Label>
              <Input
                id="material-arquivo"
                data-testid="material-arquivo"
                ref={inputArquivo}
                type="file"
                accept=".pdf,.md,.txt"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                disabled={enviando}
              />
              <p className="text-xs text-text-muted">
                PDF, Markdown ou texto, até 20 MB. Um PDF só de imagens escaneadas não tem
                letra nenhuma para ler — envie uma versão com texto selecionável.
              </p>
            </div>
          ) : null}

          {!porRotina && !arquivo ? (
            <div className="space-y-2">
              <Label htmlFor="material-conteudo">
                {aceitaArquivo(tipo) ? "…ou cole o texto aqui" : "Conteúdo"}
              </Label>
              <Textarea
                id="material-conteudo"
                data-testid="material-conteudo"
                rows={10}
                placeholder={ePerguntaEResposta(tipo) ? EXEMPLO_FAQ : EXEMPLO_DOCUMENTO}
                value={conteudo}
                onChange={(e) => setConteudo(e.target.value)}
                disabled={enviando}
              />
              {ePerguntaEResposta(tipo) ? (
                <p className="text-xs text-text-muted">
                  Uma linha <code>## Pergunta:</code> e uma <code>## Resposta:</code> por item,
                  separados por uma linha em branco.
                </p>
              ) : null}
            </div>
          ) : null}

          {!podeIndexar ? (
            <p className="text-xs text-warning-fg" data-testid="material-aviso-sem-chave">
              Sem uma chave da OpenAI, o material fica guardado e esperando — o agente só passa
              a conhecê-lo depois que a chave for cadastrada.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={criar} disabled={enviando || porRotina} data-testid="material-criar">
            {enviando ? "Guardando…" : "Adicionar ao acervo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
