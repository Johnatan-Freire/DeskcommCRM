/**
 * `lgpd_requests.due_at` é um DIA CIVIL — e todo mundo precisa lê-lo como dia.
 *
 * ═══ O QUE ESTE ARQUIVO SEGURA ═══
 *
 * Duas coisas, e as duas são do mesmo defeito:
 *
 * 1. **A régua.** `computeDueAt` devolve a meia-noite UTC do dia útil contado, e
 *    o prazo vai até o FIM desse dia. A coluna guarda esse dia; quem mostra,
 *    compara ou conta tem de ler ESSE dia. As funções `diaDoPrazo`,
 *    `diasDeAtraso`, `diasAtePrazo` e `prazoEmBr` são o caminho único, e elas
 *    não recebem fuso nenhum justamente porque não devem receber.
 *
 * 2. **A lista de consumidores.** A varredura do fim do arquivo não pergunta
 *    "este arquivo passa pelo helper?" (isso é o segundo bloco) — ela pergunta
 *    "existe algum arquivo que leia `due_at` sem estar na lista?". A lista tem
 *    duas partes: quem já lê pelo helper, e a DÍVIDA CONGELADA com o motivo
 *    escrito por entrada. Nas duas, casar é por ARQUIVO e nunca por linha, para
 *    que um rebase alheio não acerte o vermelho; entrada que deixa de casar é
 *    vermelho pedindo remoção — a lista só encolhe.
 *
 *    É a mesma forma das catracas que a casa já aceita (`DIVIDA_CONGELADA` no
 *    guardião de espanhol, `DADO_DO_OPERADOR_CONGELADO` no #1867): a dívida fica
 *    nomeada e some por entrada, não por esquecimento.
 *
 * ═══ POR QUE A REGRA É "DIA CIVIL" E NÃO "INSTANTE" ═══
 *
 * O prazo não é um instante: é o último dia útil que o titular pode esperar. Guardá-lo
 * como instante obriga quem lê a escolher um fuso — e qualquer escolha errada
 * desloca a etiqueta um dia. O engine já conta em dias (`computeDueAt`), já pula
 * feriado do PAÍS da organização (`perfilDoPais(...).calendario.feriados`), e a
 * escrita tem UM escritor só (`lib/lgpd/repository.ts`). Com isso a convenção é
 * verificável, e este arquivo a verifica.
 *
 * Medido (Este arquivo, `lib/lgpd/sla.ts`): pedido recebido em 2026-09-14 com
 * D+15 => `due_at = 2026-10-05T00:00:00.000Z`. Em São Paulo, o mesmo instante é
 * 04/10/2026 21:00 — o dia ANTERIOR ao prazo contado, com uma hora que não
 * significa nada. Ver o cenário "o dia do prazo não é atraso" abaixo.
 */

import { readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import {
  computeDueAt,
  diaDoPrazo,
  diasAtePrazo,
  diasDeAtraso,
  horasAteOFimDoPrazo,
  prazoEmBr,
} from "@/lib/lgpd/sla";
import { computeRiskLevel, computeSlaBucket } from "@/lib/lgpd/balde-de-sla";
import { contagemDoPrazo } from "@/lib/lgpd/contagem-do-prazo";

const RAIZ = process.cwd();
const DIA_MS = 86_400_000;

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Dia civil do instante, no eixo em que `computeDueAt` conta. */
function civil(instante: Date): string {
  return instante.toISOString().slice(0, 10);
}

/** O mesmo instante, no eixo em que o LEITOR brasileiro vive (UTC−3, sem DST em 2026). */
function emSaoPaulo(instante: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

describe("a coluna due_at é um dia civil", () => {
  it("computeDueAt devolve a meia-noite UTC do dia útil contado", () => {
    // Segunda 2026-09-14 + 15 dias úteis.
    expect(civil(computeDueAt(d("2026-09-14"), 15))).toBe("2026-10-05");
    expect(computeDueAt(d("2026-09-14"), 15).getUTCHours()).toBe(0);
  });

  it("diaDoPrazo devolve o dia que a coluna guarda, sem depender de fuso", () => {
    const prazo = computeDueAt(d("2026-09-14"), 15);
    expect(diaDoPrazo(prazo)).toBe("2026-10-05");
    expect(diaDoPrazo(prazo.toISOString())).toBe("2026-10-05");
  });

  it("o MESMO prazo é o dia anterior para quem lê a oeste de UTC — o defeito", () => {
    const prazo = computeDueAt(d("2026-09-14"), 15);
    // A INSTANTE, redesenhado no fuso do leitor brasileiro, é o dia anterior.
    expect(emSaoPaulo(prazo)).toBe("2026-10-04");
    // O DIA CIVIL, lido pelo helper, é o dia que o motor contou.
    expect(diaDoPrazo(prazo)).toBe("2026-10-05");
  });
});

describe("o dia do prazo não é atraso", () => {
  const prazo = computeDueAt(d("2026-09-14"), 15); // 2026-10-05T00:00:00Z

  it("não está atrasado em nenhum instante do dia do prazo", () => {
    // Do primeiro instante do dia civil até o último, em MEIA-NOITE UTC.
    for (const hora of [0, 3, 6, 9, 12, 15, 18, 21, 23]) {
      const instante = new Date(prazo.getTime() + hora * 3_600_000);
      expect(diasDeAtraso(prazo, instante)).toBe(0);
      expect(diasAtePrazo(prazo, instante)).toBe(0);
    }
  });

  it("em São Paulo continua zero às 09h e às 21h do dia do prazo", () => {
    // 09:00 de 05/10 em São Paulo = 12:00Z. A conta antiga em milissegundos
    // arredondava 0.5 para 1 e dizia "1 dia(s) em atraso" — medido.
    const noveDaManha = new Date("2026-10-05T12:00:00.000Z");
    expect(emSaoPaulo(noveDaManha)).toBe("2026-10-05");
    expect(diasDeAtraso(prazo, noveDaManha)).toBe(0);
    // 21:00 de 04/10 em São Paulo = 00:00Z do dia do prazo. O prazo NUNCA
    // termina antes de o dia acabar; a etiqueta "atrasado" aparecia aqui.
    const noiteDeOntem = new Date("2026-10-05T00:00:00.000Z");
    expect(emSaoPaulo(noiteDeOntem)).toBe("2026-10-04");
    expect(diasDeAtraso(prazo, noiteDeOntem)).toBe(0);
  });

  it("conta a partir do dia SEGUINTE ao prazo", () => {
    expect(diasDeAtraso(prazo, new Date("2026-10-06T00:00:00.000Z"))).toBe(1);
    expect(diasDeAtraso(prazo, new Date("2026-10-06T00:00:00.000Z"))).not.toBe(
      Math.round((new Date("2026-10-06T12:00:00.000Z").getTime() - prazo.getTime()) / DIA_MS) + 1,
    );
    expect(diasDeAtraso(prazo, new Date("2026-10-07T23:00:00.000Z"))).toBe(2);
    expect(diasDeAtraso(prazo, new Date("2026-09-20T12:00:00.000Z"))).toBe(-15);
  });

  it("o eixo é o mesmo em ambos os sentidos: soma de dias civis, não de milissegundos", () => {
    // Uma semana atravessando a virada do mês, para pegar overflow de mês.
    const prazoNoMes = computeDueAt(d("2026-09-28"), 5); // 2026-10-05
    expect(diaDoPrazo(prazoNoMes)).toBe("2026-10-05");
    expect(diasDeAtraso(prazoNoMes, new Date("2026-10-13T00:00:00.000Z"))).toBe(8);
    expect(diasAtePrazo(prazoNoMes, new Date("2026-10-13T00:00:00.000Z"))).toBe(-8);
  });
});

describe("prazoEmBr escreve o dia, e não o instante", () => {
  const prazo = computeDueAt(d("2026-09-14"), 15); // 2026-10-05T00:00:00Z

  it("formata DD/MM/AAAA a partir do dia civil", () => {
    expect(prazoEmBr(prazo)).toBe("05/10/2026");
  });

  it("o mesmo prazo, formatado com fuso, seria o dia anterior — o defeito medido", () => {
    const comFuso = prazo.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    expect(comFuso).toContain("04/10/2026");
    expect(prazoEmBr(prazo)).not.toContain("04/10/2026");
  });
});

describe("valor ilegível nunca vira atraso nem deadline inventado", () => {
  it("null/undefined viram zero e rótulo ausente", () => {
    for (const invalido of [null, undefined, "", "não-é-data"]) {
      expect(diasDeAtraso(invalido, new Date())).toBe(0);
      expect(diasAtePrazo(invalido, new Date())).toBe(0);
      expect(diaDoPrazo(invalido)).toBeNull();
      expect(prazoEmBr(invalido)).toBeNull();
    }
  });

  it("uma data de calendário impossível não vira janeiro do ano seguinte", () => {
    // `Date.UTC(2026, 12, 45)` normaliza para janeiro de 2027 — um prazo
    // inventado a partir de lixo. Precisa devolver `null`, não uma data.
    expect(diaDoPrazo("2026-13-45T00:00:00.000Z")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// O BALDE DA LINHA — o defeito visto pelo lado de quem prioriza trabalho
// ---------------------------------------------------------------------------

describe("o balde de SLA da linha não acende antes do prazo", () => {
  const recebido = "2026-09-14T12:00:00.000Z";
  const prazo = computeDueAt(d("2026-09-14"), 15).toISOString(); // 2026-10-05T00:00:00Z
  /** Balde como a versão em MILISSEGUNDOS decidia, para a comparação ser explícita. */
  const baldeAntigo = (agora: Date): string => {
    const ms = new Date(prazo).getTime() - agora.getTime();
    if (ms < 0) return "overdue";
    if (ms < 2 * DIA_MS) return "critical";
    return "ok";
  };

  it("não diz 'Vencido' nas 26 horas em que o prazo ainda está por vir", () => {
    // 04/10 21:30 em São Paulo = 05/10 00:30Z: a meia-noite UTC do dia do prazo
    // JÁ PASSOU, e é isso que fazia a linha dizer "Vencido" com 26h30 pela frente.
    const noiteVinteHoras = new Date("2026-10-05T00:30:00.000Z");
    expect(emSaoPaulo(noiteVinteHoras)).toBe("2026-10-04");
    expect(baldeAntigo(noiteVinteHoras)).toBe("overdue"); // o defeito
    expect(computeSlaBucket(prazo, recebido, noiteVinteHoras)).not.toBe("overdue");
  });

  it("no dia do prazo é 'Crítico', e 'Vencido' só no dia seguinte", () => {
    const manhaDoPrazo = new Date("2026-10-05T12:00:00.000Z"); // 09:00 em São Paulo
    expect(computeSlaBucket(prazo, recebido, manhaDoPrazo)).toBe("critical");

    const noiteDoPrazo = new Date("2026-10-05T23:30:00.000Z"); // 20:30 em São Paulo
    expect(baldeAntigo(noiteDoPrazo)).toBe("overdue"); // o defeito
    expect(computeSlaBucket(prazo, recebido, noiteDoPrazo)).toBe("critical");

    const diaSeguinte = new Date("2026-10-06T12:00:00.000Z"); // 09:00 de 06/10
    expect(computeSlaBucket(prazo, recebido, diaSeguinte)).toBe("overdue");
  });

  it("prazo ausente é 'ok' — quem não tem prazo não está vencendo nada", () => {
    expect(computeSlaBucket(null, recebido, new Date("2026-12-01T00:00:00.000Z"))).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// O PAINEL DA PLATAFORMA — o selo e a contagem leem o MESMO dia
// ---------------------------------------------------------------------------

describe("o selo do painel e o balde da organização viram no mesmo instante", () => {
  const recebido = "2026-09-14T12:00:00.000Z";
  const prazo = computeDueAt(d("2026-09-14"), 15).toISOString(); // 2026-10-05T00:00:00Z

  /** Selo como a rota de ADMIN comparava, para o defeito ficar explícito. */
  const seloAntigo = (agora: Date): string => {
    const ms = new Date(prazo).getTime() - agora.getTime();
    if (ms < 0) return "expired";
    if (ms < DIA_MS) return "at_risk";
    return "ok";
  };

  it("não marca 'Vencido' na véspera: às 22h de 04/10 o prazo é amanhã", () => {
    // 04/10 22:00 em São Paulo = 05/10 01:00Z.
    const noiteDaVespera = new Date("2026-10-05T01:00:00.000Z");
    expect(emSaoPaulo(noiteDaVespera)).toBe("2026-10-04");
    expect(seloAntigo(noiteDaVespera)).toBe("expired"); // o defeito
    expect(computeRiskLevel(prazo, recebido, noiteDaVespera)).not.toBe("expired");
    // E o balde da organização já acertava neste ponto — discordava só o selo.
    expect(computeSlaBucket(prazo, recebido, noiteDaVespera)).toBe("critical");
  });

  it("no dia do prazo é 'Crítico', e 'Vencido' no dia seguinte", () => {
    const manhaDoPrazo = new Date("2026-10-05T12:00:00.000Z"); // 09:00 em São Paulo
    expect(seloAntigo(manhaDoPrazo)).toBe("expired"); // o defeito
    expect(computeRiskLevel(prazo, recebido, manhaDoPrazo)).toBe("at_risk");

    const diaSeguinte = new Date("2026-10-06T12:00:00.000Z"); // 09:00 de 06/10
    expect(computeRiskLevel(prazo, recebido, diaSeguinte)).toBe("expired");
  });

  it("prazo ausente ou ilegível é 'ok' — lixo não fica vermelho no painel de quem administra", () => {
    const tarde = new Date("2026-10-05T12:00:00.000Z");
    expect(computeRiskLevel(null, recebido, tarde)).toBe("ok");
    expect(computeRiskLevel("não-é-data", recebido, tarde)).toBe("ok");
  });

  it("os dois selos nunca discordam sobre 'vencido', em 97 horas de relógio", () => {
    // A propriedade que motivou trazer `computeRiskLevel` para `balde-de-sla.ts`:
    // os dois baldes classificam o mesmo `due_at`, então não podem discordar
    // sobre a única coisa que os dois dizem — se o prazo passou.
    for (let h = -48; h <= 48; h += 1) {
      const agora = new Date(new Date(prazo).getTime() + h * 3_600_000);
      const overdueOrg = computeSlaBucket(prazo, recebido, agora) === "overdue";
      const expiredPainel = computeRiskLevel(prazo, recebido, agora) === "expired";
      expect(
        overdueOrg,
        `divergem em ${h}h: org=overdue ${overdueOrg}, painel=expired ${expiredPainel}`,
      ).toBe(expiredPainel);
    }
  });
});

describe("a coluna 'Vence em' conta até o FIM do dia, não até a meia-noite UTC", () => {
  const prazo = computeDueAt(d("2026-09-14"), 15).toISOString(); // 2026-10-05T00:00:00Z
  const t = (texto: string) => texto;

  /** Contagem como o componente comparava, para o defeito ficar explícito. */
  const contagemAntiga = (agora: Date): string => {
    const horas = Math.trunc((new Date(prazo).getTime() - agora.getTime()) / 3_600_000);
    if (horas < 0) return `${Math.abs(horas)}h em atraso`;
    if (horas < 24) return `${horas}h restantes`;
    return `${Math.floor(horas / 24)}d restantes`;
  };

  it("às 9h do dia do prazo: vence hoje, e não '12h em atraso'", () => {
    const manha = new Date("2026-10-05T12:00:00.000Z"); // 09:00 em São Paulo
    expect(emSaoPaulo(manha)).toBe("2026-10-05");
    expect(contagemAntiga(manha)).toBe("12h em atraso"); // o defeito
    expect(contagemDoPrazo(prazo, "received", t, manha)).toBe("12h restantes");
  });

  it("às 21h da véspera ainda resta um dia inteiro", () => {
    const noite = new Date("2026-10-05T00:00:00.000Z"); // 04/10 21:00 em São Paulo
    expect(emSaoPaulo(noite)).toBe("2026-10-04");
    expect(contagemAntiga(noite)).toBe("0h restantes"); // o defeito
    expect(contagemDoPrazo(prazo, "received", t, noite)).toBe("1d restantes");
  });

  it("'em atraso' começa na primeira hora cheia depois de o DIA acabar", () => {
    // 05/10 20:00 em São Paulo = 05/10 23:00Z: ainda dentro do dia guardado.
    const vinteHoras = new Date("2026-10-05T23:00:00.000Z");
    expect(emSaoPaulo(vinteHoras)).toBe("2026-10-05");
    expect(contagemAntiga(vinteHoras)).toBe("23h em atraso"); // o defeito
    expect(contagemDoPrazo(prazo, "received", t, vinteHoras)).toBe("1h restantes");

    // 05/10 22:00 em São Paulo: uma hora e meia depois do fim do dia.
    const umaHoraDepois = new Date("2026-10-06T01:30:00.000Z");
    expect(emSaoPaulo(umaHoraDepois)).toBe("2026-10-05");
    expect(contagemAntiga(umaHoraDepois)).toBe("25h em atraso"); // o defeito
    expect(contagemDoPrazo(prazo, "received", t, umaHoraDepois)).toBe("1h em atraso");
  });

  it("a última hora do dia do prazo não contradiz o selo (21:00 a 21:59 de São Paulo)", () => {
    // O defeito que o mantenedor apontou ao revisar o #2168: nesta hora a linha
    // dizia "0h restantes" enquanto o selo já dizia "Vencido". As duas âncoras
    // viram no mesmo instante (o fim do dia guardado); a hora de "0h" vinha do
    // `Math.trunc`, que leva (-1h, 0] a zero.
    for (const minuto of [0, 1, 15, 30, 45, 59]) {
      const instante = new Date(Date.UTC(2026, 9, 6, 0, minuto, 30));
      expect(emSaoPaulo(instante)).toBe("2026-10-05");
      // O selo diz vencido nesta hora inteira...
      expect(computeRiskLevel(prazo, prazo, instante)).toBe("expired");
      // ...e a linha diz a mesma coisa, na menor unidade que ela tem.
      expect(contagemDoPrazo(prazo, "received", t, instante)).toBe("1h em atraso");
      expect(computeSlaBucket(prazo, prazo, instante)).toBe("overdue");
    }
  });

  it("a linha e o selo nunca discordam sobre 'em atraso', hora a hora em 97 horas", () => {
    // A prova de que a hora apontada na revisão foi fechada: se alguém voltar a
    // governar a frase pela contagem truncada, esta varredura acha o minuto.
    for (let h = -48; h <= 48; h += 1) {
      for (const minuto of [0, 30]) {
        const instante = new Date(new Date(prazo).getTime() + h * 3_600_000 + minuto * 60_000);
        const linhaDizAtraso = contagemDoPrazo(prazo, "received", t, instante).includes("atraso");
        const seloDizVencido = computeRiskLevel(prazo, prazo, instante) === "expired";
        expect(
          linhaDizAtraso,
          `divergem em ${instante.toISOString()}: linha=${linhaDizAtraso}, selo=${seloDizVencido}`,
        ).toBe(seloDizVencido);
      }
    }
  });

  it("o pedido terminado e o prazo ilegível não têm nada a dizer", () => {
    const agora = new Date("2026-10-05T12:00:00.000Z");
    for (const status of ["completed", "failed"] as const) {
      expect(contagemDoPrazo(prazo, status, t, agora)).toBe("—");
    }
    expect(contagemDoPrazo(null, "received", t, agora)).toBe("—");
    expect(contagemDoPrazo("não-é-data", "received", t, agora)).toBe("—");
  });

  it("o vocabulário não ganhou nenhuma palavra nova", () => {
    // As quatro formas de antes continuam as quatro de agora. Uma frase nova
    // entraria no dicionário e na conta de quem revisa tradução; esta não entra.
    const formas = new Set<string>();
    for (let h = -96; h <= 96; h += 1) {
      const instante = new Date(new Date(prazo).getTime() + h * 3_600_000);
      formas.add(contagemDoPrazo(prazo, "received", t, instante));
    }
    const semNumero = (s: string) => s.replace(/^\d+[hd] /, "").trim();
    expect([...new Set([...formas].map(semNumero))].sort()).toEqual(["em atraso", "restantes"]);
  });

  it("o tradutor injetado é usado, com a frase como literal", () => {
    // O guardião de espanhol varre `lib/` atrás de `t("literal")`, então a frase
    // precisa continuar literal aqui dentro — e o teste prova que ela chega ao
    // tradutor, e não que alguém embrulhou a chamada por cima.
    const chamada: string[] = [];
    const coletor = (texto: string) => {
      chamada.push(texto);
      return `[${texto}]`;
    };
    const virada = new Date("2026-10-06T01:30:00.000Z");
    expect(contagemDoPrazo(prazo, "received", coletor, virada)).toBe("1h [em atraso]");
    expect(chamada).toEqual(["em atraso"]);
  });
});

// ---------------------------------------------------------------------------
// A LISTA DE CONSUMIDORES — a parte que impede a classe de voltar
// ---------------------------------------------------------------------------

/** Raízes onde `due_at` pode aparecer; o resto do produto não tem SLA de LGPD. */
const AREAS = [
  "lib/lgpd",
  "app/api/v1/lgpd",
  "app/app/lgpd",
  "app/admin/(protected)/lgpd",
  "app/api/mcp/tools",
  // O painel da plataforma lê o mesmo `due_at` por outra porta: a API de
  // administração, o cron do alarme e a tabela de `components/admin`. Fora
  // daqui, `computeRiskLevel` marcava "Vencido" na véspera sem lista nenhuma.
  "app/api/v1/admin",
  "app/api/v1/cron",
  "components/admin",
];

function arquivosDaArea(raiz: string): string[] {
  const out: string[] = [];
  const visitar = (dir: string): void => {
    let entradas: Dirent[];
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entrada of entradas) {
      const caminho = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        visitar(caminho);
      } else if (/\.tsx?$/.test(entrada.name)) {
        out.push(relative(raiz, caminho).replaceAll(sep, "/"));
      }
    }
  };
  for (const area of AREAS) {
    const dir = join(raiz, area);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    visitar(dir);
  }
  return out;
}

function leDueAt(arquivo: string): string[] {
  return readFileSync(join(RAIZ, arquivo), "utf8")
    .split(/\r?\n/)
    .map((linha, i) => ({ linha: i + 1, texto: linha }))
    .filter((l) => /due_at/.test(l.texto))
    .map((l) => `${l.linha}: ${l.texto.trim()}`);
}

/**
 * O arquivo SEM COMENTÁRIOS.
 *
 * Existe porque este módulo escreve o defeito antigo por extenso nos cabeçalhos
 * — e um gate que caçasse `Math.round(... / 86_400_000` no fonte inteiro
 * reprovaria o próprio comentário que explica por que ele saiu. Caçar em
 * comentário é como o gate de espanhol caiu na armadilha que `vitest.cercas.ts`
 * documenta: a régua precisa do código, não da prosa sobre o código.
 */
function codigoSemComentario(arquivo: string): string {
  return readFileSync(join(RAIZ, arquivo), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * Quem JÁ lê pelo helper. Entrar aqui é a forma de o código passar: casar é por
 * arquivo e a presença do import é conferida no teste do dente.
 */
const LEEM_PELO_HELPER: readonly string[] = [
  "lib/lgpd/sla.ts",
  "lib/lgpd/sla-alarm.ts",
  "lib/lgpd/balde-de-sla.ts",
  "lib/lgpd/contagem-do-prazo.ts",
  "lib/lgpd/repository.ts",
  "app/api/v1/lgpd/requests/route.ts",
  "app/api/v1/admin/lgpd/requests/route.ts",
  "components/admin/lgpd/LgpdRequestsTable.tsx",
  "app/app/lgpd/requests/[id]/_client.tsx",
];

/**
 * Quem só REPASSA o valor, sem mostrar nem comparar. A coluna é dada de máquina
 * aqui — sair como foi guardado é o comportamento certo, e mexer seria pior.
 */
const REPASSA_O_VALOR: readonly string[] = [
  "lib/lgpd/types.ts",
  "lib/database.types.ts",
  "lib/mcp/tools/privacidade.ts",
  "app/api/v1/lgpd/requests/[id]/route.ts",
  "app/api/v1/lgpd/requests/[id]/approve/route.ts",
  "app/api/v1/webhooks/nuvemshop/customer-redact/route.ts",
  "app/api/v1/webhooks/nuvemshop/store-redact/route.ts",
  "app/api/v1/webhooks/nuvemshop/customer-data-request/route.ts",
  "hooks/useLgpdRequests.ts",
  "hooks/useAdminLGPDRequests.ts",
  "app/api/v1/admin/lgpd/requests/[id]/route.ts",
  "app/api/v1/cron/lgpd-sla-watcher/route.ts",
];

/**
 * DÍVIDA CONGELADA — quem ainda redesenha o instante com fuso ou o compara em
 * milissegundos, e por quê. Cada entrada carrega o motivo escrito; entrada que
 * deixa de casar é vermelho pedindo remoção. É a fila dos próximos recortes, e
 * ela é o que impede este PR de parecer um conserto pela metade.
 */
const DIVIDA_CONGELADA: ReadonlyArray<{ arquivo: string; motivo: string }> = [
  {
    arquivo: "app/admin/(protected)/lgpd/requests/[id]/_client.tsx",
    motivo:
      "Tela: a linha 'Vence em' JÁ foi corrigida (`prazoEmBr`). O que resta neste arquivo é o `SlaTimelineInline`, que ainda mede `dueAt.getTime()` — o mesmo defeito de família, agora no progresso e no 'Nd restantes' — e é cópia de `app/app/lgpd/requests/[id]/SlaTimeline.tsx`. Os dois pedem UM dono só, e o recorte é das telas.",
  },
  {
    arquivo: "app/app/lgpd/requests/RequestsTable.tsx",
    motivo:
      "Tela: `fmtDistance(due_at)` em milissegundos — diz 'atrasado hoje' às 21h do dia ANTERIOR ao prazo.",
  },
  {
    arquivo: "app/app/lgpd/requests/[id]/SlaTimeline.tsx",
    motivo:
      "Tela: `differenceInDays(dueAt, now)` em dias locais. Defeito IRMÃO e mais fundo: os marcos D+5/D+7/D+10 são dias CORRIDOS desde `received_at`, enquanto o prazo é dias ÚTEIS — duas réguas na mesma tela.",
  },
  {
    arquivo: "app/api/v1/admin/dashboard/kpis/route.ts",
    motivo:
      "Filtra `due_at` em SQL contra `now + 5 dias`, então acende 'LGPD em risco' 3h antes do prazo e não tem como usar o helper sem tirar a comparação da query. Recorte de banco/API depois das telas.",
  },
];

/**
 * Os módulos que DETÊM a leitura do dia. Estar na lista só vale se o arquivo
 * **importar** um deles — não basta citar o nome.
 *
 * A distinção não é preciosismo: a primeira versão deste gate procurava o NOME
 * da função, e a sabotagem de apagar só a linha do `import` passou verde. O nome
 * continuava no arquivo porque a chamada continua lá — quem apagou o import
 * deixou um arquivo que nem compila, e um gate que não vê isso é o "gate que
 * devolve verde" que a casa chama de pior defeito. `pnpm typecheck` pegaria a
 * sabotagem; o gate precisa pegar sozinho, porque é ele que existe para vigiar a
 * leitura quando ninguém está olhando o compilador.
 */
const MODULOS_QUE_LEEM_O_DIA = [
  "@/lib/lgpd/sla",
  "@/lib/lgpd/balde-de-sla",
  "@/lib/lgpd/contagem-do-prazo",
  "./sla",
  "./balde-de-sla",
  "./contagem-do-prazo",
];

function importaLeitorDeDia(fonte: string): boolean {
  return MODULOS_QUE_LEEM_O_DIA.some((modulo) =>
    new RegExp(`from\\s+"${modulo.replace(/[./]/g, "\\$&")}"`).test(fonte),
  );
}

describe("nenhum consumidor de due_at nasce fora da lista", () => {
  const conhecidos = new Set([
    ...LEEM_PELO_HELPER,
    ...REPASSA_O_VALOR,
    ...DIVIDA_CONGELADA.map((d) => d.arquivo),
  ]);

  const descobertos = arquivosDaArea(RAIZ)
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
    .filter((f) => leDueAt(f).length > 0)
    .filter((f) => !conhecidos.has(f));

  it("a varredura acha os consumidores que a lista declara (a lista não é decorativa)", () => {
    // Se a lista mencionasse um arquivo que não existe, ela pararia de valer
    // como lista — e é a forma mais barata de um gate de varredura envelhecer.
    for (const arquivo of DIVIDA_CONGELADA) {
      expect(arquivo.motivo.trim().length).toBeGreaterThan(0);
      expect(readFileSync(join(RAIZ, arquivo.arquivo), "utf8")).toContain("due_at");
    }
    for (const arquivo of [...LEEM_PELO_HELPER, ...REPASSA_O_VALOR]) {
      expect(readFileSync(join(RAIZ, arquivo), "utf8")).toContain("due_at");
    }
  });

  it("todo arquivo que lê due_at está na lista, com motivo escrito quando é dívida", () => {
    expect(descobertos.map((f) => `${f} → ${leDueAt(f).join(" | ")}`)).toEqual([]);
  });

  it("quem entra em LEEM_PELO_HELPER IMPORTa um leitor de dia de verdade (dente do gate)", () => {
    // Este é o teste que fica VERMELHO quando alguém volta a usar `new
    // Date(due_at)` com fuso, OU quando apaga o import e deixa a chamada órfã.
    // Nos dois casos o nome da função continua no arquivo; só o `from` some.
    for (const arquivo of LEEM_PELO_HELPER) {
      // `sla.ts` É o leitor; ele não se importa. A exceção fica escrita e nomeada
      // em vez de silenciosa, porque uma exceção muda de "quem?" para "ele se
      // importa?" no dia em que o dono do módulo sai dali.
      if (arquivo === "lib/lgpd/sla.ts") continue;
      const fonte = readFileSync(join(RAIZ, arquivo), "utf8");
      expect(
        importaLeitorDeDia(fonte),
        `${arquivo} entrou na lista de quem lê pelo helper e não importa nenhum leitor de dia: ` +
          "ou ele lê o dia civil por outro caminho (declare por que), ou a lista mentiu.",
      ).toBe(true);
    }
  });

  /**
   * A SABOTAGEM, escrita como asserção.
   *
   * O teste acima só pega quem APAGA o import. Este pega quem mantém o import e
   * volta a usar o instante ao lado dele — que é a forma do conserto regredir na
   * prática. As duas expressões abaixo são literalmente as que a versão anterior
   * usava, e o par `(arquivo, padrão)` é o que a sabotagem mede.
   */
  it("nenhum consumidor corrigido volta a formatar ou comparar due_at em ms (sabotagem)", () => {
    const armadilhas: Array<[string, RegExp, string]> = [
      [
        "lib/lgpd/sla-alarm.ts",
        /Math\.round\(\s*\(?[\s\S]{0,80}due[\s\S]{0,80}\/\s*86_400_000/,
        "a contagem de atraso voltou a ser aritmética de milissegundos — um dia do prazo passa a contar como atraso a partir do meio-dia.",
      ],
      [
        "lib/lgpd/sla-alarm.ts",
        /toLocaleString\([\s\S]{0,200}timeZone/,
        "o prazo voltou a ser formatado com fuso — para quem lê a oeste de UTC volta a sair o dia anterior.",
      ],
      [
        "lib/lgpd/balde-de-sla.ts",
        /Math\.round\(\s*\(?[\s\S]{0,80}due[\s\S]{0,80}\/\s*86_400_000/,
        "o balde voltou a comparar instantes — 'Vencido' acende 26 horas antes do prazo.",
      ],
      [
        "lib/lgpd/balde-de-sla.ts",
        /msUntilDue/,
        "o selo da plataforma voltou a medir a distância até a MEIA-NOITE UTC do dia do prazo, e não até o fim desse dia — é o que fazia 'expired' cair na véspera.",
      ],
      [
        "lib/lgpd/contagem-do-prazo.ts",
        /differenceInHours|new Date\(dueAt\)\.getTime\(\)/,
        "a coluna 'Vence em' voltou a contar até a meia-noite UTC do dia, e não até o fim dele — '12h em atraso' às 9h do dia do prazo.",
      ],
      [
        "lib/lgpd/contagem-do-prazo.ts",
        /if\s*\(\s*(?:inteiras|horas)\s*<\s*0\s*\)/,
        "a frase 'em atraso' voltou a ser governada pela contagem truncada (`inteiras < 0`) em vez do predicado do selo — o `Math.trunc` leva (-1h, 0] a zero, e é o que fazia a última hora do dia do prazo dizer '0h restantes' ao lado de 'Vencido'.",
      ],
      [
        "app/app/lgpd/requests/[id]/_client.tsx",
        /new Date\(\s*request\.due_at\s*\)/,
        "a linha 'Vence em' da tela de detalhe voltou a construir um INSTANTE a partir de `request.due_at` — para quem lê a oeste de UTC volta a sair o dia anterior. Use `prazoEmBr`.",
      ],
      [
        "app/admin/(protected)/lgpd/requests/[id]/_client.tsx",
        /new Date\(\s*request\.due_at\s*\)/,
        "a linha 'Vence em' da tela de detalhe de admin voltou a construir um INSTANTE a partir de `request.due_at` — o dia anterior para quem lê a oeste de UTC. Use `prazoEmBr`.",
      ],
    ];
    for (const [arquivo, padrao, porque] of armadilhas) {
      const fonte = codigoSemComentario(arquivo);
      expect(padrao.test(fonte), `${arquivo}: ${porque}`).toBe(false);
    }
  });
});
