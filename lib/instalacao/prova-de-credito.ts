/**
 * A chave funciona — e tem saldo?
 *
 * O produto já sabia responder a primeira metade e chamava isso de "Validada".
 * O validador bate em `GET /v1/models` de cada provedor: um endpoint de
 * LISTAGEM, que não consome crédito e responde 200 com a conta zerada. Ou seja,
 * o selo verde prova que a chave existe e é aceita — nunca que ela vai
 * funcionar. Quem instalou, viu "Validada" e recebeu erro na primeira conversa
 * não tinha como saber onde olhar.
 *
 * A única coisa que prova saldo é a coisa que o provedor cobra: uma geração.
 * Por isso a prova aqui é uma chamada real, mínima (um token), e por isso ela
 * nunca sai de graça — é explicitamente pedida, não roda num GET que a tela
 * chama sozinha.
 *
 * ⚠️ Não usa `runModelCall` de propósito: aquele caminho grava em `llm_calls` e
 * é barrado pelo orçamento mensal. Um diagnóstico não pode poluir a tabela que
 * ele mesmo lê, nem ser recusado justamente quando o operador precisa descobrir
 * por que nada funciona.
 */
import { normalizarErro } from "@/lib/agent-engine/edge/llm/run-model-call";
import {
  cabecalhosDeAtribuicaoOpenRouter,
  OPENROUTER_ENDPOINT,
} from "@/lib/agent-engine/edge/llm/providers";

export type ResultadoDaProva =
  | { ok: true }
  | {
      ok: false;
      /** Mesmos baldes da tela de Execuções — uma régua só para o mesmo erro. */
      codigo: string;
      mensagem: string;
      httpStatus: number | null;
    };

interface Requisicao {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A menor geração possível em cada provedor — na maioria, um único token,
 * porque o objetivo é atravessar a cobrança, não obter texto. O nome do
 * parâmetro de teto varia por provedor (`max_tokens` na Anthropic e no
 * OpenRouter, `max_completion_tokens` na OpenAI, `maxOutputTokens` no
 * Google) — e a OpenAI também é a exceção ao "um único token": ver o
 * comentário no caso `openai`.
 */
export function montarRequisicaoDeProva(
  provider: string,
  apiKey: string,
  modelo: string,
  baseUrl?: string,
): Requisicao | null {
  const msg = [{ role: "user", content: "oi" }];
  switch (provider) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: { model: modelo, max_tokens: 1, messages: msg },
      };
    case "openai":
      // ⚠️ `max_completion_tokens`, NUNCA `max_tokens`. A família de modelos mais
      // nova da OpenAI (gpt-5.x, o1, o3...) RECUSA `max_tokens` com 400
      // "Unsupported parameter" — e o catálogo de modelos (migration 0104) já
      // marca um modelo dessa família como default do provider `openai`, então
      // toda instalação nova batia nesse erro ao testar a própria chave.
      // `max_completion_tokens` é o substituto que a OpenAI documenta para
      // TODOS os modelos da Chat Completions API, não só os novos — não há
      // motivo para manter os dois nomes por modelo.
      //
      // ⚠️ E não pode ser `1`. Nos modelos de raciocínio o teto é dividido com
      // os `reasoning_tokens` internos (nem sempre visíveis, e variam de
      // chamada para chamada) — medido contra a chave real de uma instalação:
      // 1 e 4 tokens devolvem 400/200-com-conteúdo-vazio antes de sobrar
      // espaço pra qualquer palavra, e os dois desfechos são diferentes de
      // "chave ruim" mas caem no balde genérico de erro em `normalizarErro`,
      // o mesmo "selo verde mentiroso" que o cabeçalho deste arquivo existe
      // para evitar. 32 sobrou espaço de sobra nos testes (resposta completa
      // com 9 tokens, folga pro raciocínio variar) sem deixar de ser uma
      // geração mínima.
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: { model: modelo, max_completion_tokens: 32, messages: msg },
      };
    case "openrouter":
      return {
        url: `${baseUrl ?? OPENROUTER_ENDPOINT}/chat/completions`,
        // Os mesmos cabeçalhos de atribuição dos outros dois caminhos. Este era
        // o terceiro call site de OpenRouter e tinha ficado de fora — se os
        // headers fossem requisito de funcionamento, como o corpo do PR #266
        // supôs, a prova de crédito da instalação estaria falhando hoje. Ela
        // não está: são atribuição, e por isso ficam opcionais aqui também.
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...cabecalhosDeAtribuicaoOpenRouter(),
        },
        body: { model: modelo, max_tokens: 1, messages: msg },
      };
    case "google":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          modelo,
        )}:generateContent?key=${encodeURIComponent(apiKey)}`,
        headers: { "content-type": "application/json" },
        body: {
          contents: [{ parts: [{ text: "oi" }] }],
          generationConfig: { maxOutputTokens: 1 },
        },
      };
    default:
      // Fail-closed: provedor que este módulo não sabe cobrar não recebe um
      // "ok" por omissão — seria a frase tranquilizadora de novo.
      return null;
  }
}

/** Traduz a resposta HTTP no mesmo vocabulário de erro do runtime. */
export function classificarResposta(status: number, corpo: string): ResultadoDaProva {
  if (status >= 200 && status < 300) return { ok: true };
  // `normalizarErro` lê `status` do objeto — é a régua canônica, compartilhada
  // com a tela de Execuções, e ela também redige a mensagem do provedor (que
  // pode ecoar header de autorização em endpoint próprio).
  const err = Object.assign(new Error(corpo), { status });
  const n = normalizarErro(err);
  return {
    ok: false,
    codigo: n.error_code,
    mensagem: n.error_message,
    httpStatus: n.http_status,
  };
}

const TIMEOUT_MS = 8000;

export async function provarSaldo(
  provider: string,
  apiKey: string,
  modelo: string,
  opcoes?: { baseUrl?: string; fetchImpl?: typeof fetch },
): Promise<ResultadoDaProva> {
  const req = montarRequisicaoDeProva(provider, apiKey, modelo, opcoes?.baseUrl);
  if (!req) {
    return {
      ok: false,
      codigo: "provedor_desconhecido",
      mensagem: `Não sei como testar o provedor "${provider}".`,
      httpStatus: null,
    };
  }

  const f = opcoes?.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await f(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ctrl.signal,
    });
    const corpo = await res.text().catch(() => "");
    return classificarResposta(res.status, corpo);
  } catch (err) {
    // Rede fora, DNS, timeout: NÃO é chave ruim, e dizer que é mandaria o
    // operador trocar uma chave que está certa.
    const n = normalizarErro(err);
    return { ok: false, codigo: n.error_code, mensagem: n.error_message, httpStatus: n.http_status };
  } finally {
    clearTimeout(timer);
  }
}
