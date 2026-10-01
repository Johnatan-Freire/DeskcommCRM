/**
 * CAPITAL_CODE_GOLDEN_INVARIANTS — as regras que fazem deste fork o CRM da escola.
 *
 * Por que existe: este fork recebe melhorias do upstream (DeskcommCRM) de tempos
 * em tempos. Uma atualização pode apagar, renomear ou "simplificar" o teste que
 * prova uma regra nossa, e o verde seguiria verde sem provar mais nada. Este
 * arquivo faz duas coisas:
 *
 *   1. prova DIRETO, sem banco, o que dá para provar sem banco (identidade pelo
 *      telefone, kill switch de envio, executor e ferramentas por escopo, janela
 *      de envio que cruza a meia-noite);
 *   2. amarra cada uma das 25 regras ao teste CONCRETO que a prova — inclusive
 *      os invariantes de Postgres (`pnpm test:db`). Se a prova sumir, este arquivo
 *      fica vermelho e diz qual regra ficou sem dono.
 *
 * Mudar uma regra daqui é decisão de produto da Capital Code, não detalhe de
 * merge: ajuste o teste que a prova E a linha do manifesto, no mesmo PR.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ferramentasOcultasPeloEscopo } from "@/lib/agent-engine/agent/ferramentas-por-escopo";
import { verificarPermissaoDeMoverFunil } from "@/lib/agent-engine/agent/lead-state";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { janelaDeEnvioAberta, proximaAberturaDaJanela } from "@/lib/agent-engine/pacing/engine";
import { PERFIL_ACADEMICO_ESCOLA, PERFIL_COMERCIAL_ESCOLA } from "@/lib/ai/agents/modelos-escola";
import { envioDeConversaLigado, EnvioDeSaidaDesligadoError, exigirEnvioDeConversaLigado } from "@/lib/channels/envio-de-saida";
import { getAdapter } from "@/lib/channels";
import { buscarAlunoPorTelefone, selecionarAluno, type RespostaAlunoPorTelefone } from "@/lib/integracoes/sistema-escolar";
import { decidirIdentidadeEscolar } from "@/lib/leads/identidade-escolar";
import { API_DOIS_ALUNOS } from "../fixtures/atendimento-ao-aluno";

const aluno = (nome: string, campo = "numero_contato") =>
  ({ id: 1, nome, matched_contact_field: campo }) as unknown as RespostaAlunoPorTelefone["alunos"][number];
const resposta = (o: Partial<RespostaAlunoPorTelefone>) =>
  ({ encontrado: true, match_type: "exact", alunos: [aluno("Ana Souza")], ...o }) as RespostaAlunoPorTelefone;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ─── 1. provas diretas ───────────────────────────────────────────────────────

describe("identidade pelo telefone (Sistema Escolar)", () => {
  it("1/13 · casamento EXATO com aluno → relacionado_a_aluno, mesmo por numero_contato2 — e nada além disso", () => {
    expect(decidirIdentidadeEscolar(resposta({}))).toBe("relacionado_a_aluno");
    const r = decidirIdentidadeEscolar(resposta({ alunos: [aluno("Ana Souza", "numero_contato2")] }));
    // O contrato só tem dois valores: nenhum papel familiar (pai, mãe, responsável) é inferido.
    expect(r).toBe("relacionado_a_aluno");
  });

  it("14 · outro DDD (casamento por sufixo) → desconhecido", () => {
    expect(decidirIdentidadeEscolar(resposta({ match_type: "suffix" as never }))).toBe("desconhecido");
  });

  it("15 · API sem match_type=exact → desconhecido", () => {
    expect(decidirIdentidadeEscolar(resposta({ match_type: undefined }))).toBe("desconhecido");
  });

  it("16 · consulta que falhou (timeout/erro) → desconhecido (fail-closed)", () => {
    expect(decidirIdentidadeEscolar(null)).toBe("desconhecido");
  });

  it("17 · vários alunos no número → só a QUANTIDADE, nenhum nome; o nome completo escolhe um", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(API_DOIS_ALUNOS), { status: 200 })));
    const cfg = { baseUrl: "https://escola.invalid", apiKey: "x" };
    expect(selecionarAluno(await buscarAlunoPorTelefone(cfg, "5561999990000"))).toEqual({ status: "ambiguo", quantidade: 2 });
    const um = selecionarAluno(await buscarAlunoPorTelefone(cfg, "5561999990000"), "ana ficticia lima");
    expect(um.status).toBe("encontrado");
    expect(JSON.stringify(um)).not.toMatch(/Pedro|matched_contact_field|numero_contato/);
  });
});

describe("agentes por escopo", () => {
  it("o acadêmico não move card, não marca ganho/perda e não agenda retorno — tool escondida E executor fechado", () => {
    expect(PERFIL_ACADEMICO_ESCOLA).toMatchObject({
      service_scope: "academico",
      can_update_lead_state: false,
      can_mark_won: false,
      can_mark_lost: false,
    });
    const cfg = { serviceScope: "academico" as const, canUpdateLeadState: false };
    expect(ferramentasOcultasPeloEscopo(cfg)).toEqual(expect.arrayContaining(["update_lead_state", "schedule_followup"]));
    expect(verificarPermissaoDeMoverFunil(cfg).ok).toBe(false);
    // Mesmo com a coluna dizendo o contrário, o escopo acadêmico fecha.
    expect(verificarPermissaoDeMoverFunil({ serviceScope: "academico", canUpdateLeadState: true }).ok).toBe(false);
  });

  it("o comercial move o funil mas nunca marca ganho (o funil Contatos não tem ganho)", () => {
    expect(PERFIL_COMERCIAL_ESCOLA).toMatchObject({ service_scope: "comercial", can_update_lead_state: true, can_mark_won: false });
    expect(PERFIL_COMERCIAL_ESCOLA.sistema_escolar_tool_ids).not.toContain("consultar_aluno_sistema_escolar");
  });
});

describe("OUTBOUND_MESSAGING — só o literal `enabled` libera", () => {
  it.each([
    ["ausente", undefined, false],
    ["vazio", "", false],
    ["disabled", "disabled", false],
    ["true (23)", "true", false],
    ["1", "1", false],
    ["Enabled (maiúscula)", "Enabled", false],
    ["enabled (24)", "enabled", true],
  ])("22-24 · %s → %s", (_c, valor, liga) => {
    const env = valor === undefined ? {} : { OUTBOUND_MESSAGING: valor };
    expect(envioDeConversaLigado(env as NodeJS.ProcessEnv)).toBe(liga);
    if (!liga) expect(() => exigirEnvioDeConversaLigado(env as NodeJS.ProcessEnv)).toThrow(EnvioDeSaidaDesligadoError);
  });

  it("25 · nenhuma porta do adapter (enviar, modelo, editar, apagar) passa com a trava fechada", async () => {
    vi.stubEnv("OUTBOUND_MESSAGING", "true");
    const adapter = getAdapter("waha");
    await expect(adapter.send({} as never)).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    if (adapter.editMessage) await expect(adapter.editMessage({} as never)).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    if (adapter.revokeMessage) await expect(adapter.revokeMessage({} as never)).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
  });
});

describe("janela de envio deste fork: pode cruzar a meia-noite", () => {
  const k = { ...PACING_DEFAULTS, timezone: "America/Sao_Paulo", windowStartHour: 22, windowEndHour: 7, allowSunday: true };
  const em = (iso: string) => new Date(iso);
  it("22h–7h: 23h e 3h estão DENTRO; 12h está FORA", () => {
    expect(janelaDeEnvioAberta(em("2026-10-07T02:00:00Z"), k)).toBe(true); // 23h BRT
    expect(janelaDeEnvioAberta(em("2026-10-07T06:00:00Z"), k)).toBe(true); // 3h BRT
    expect(janelaDeEnvioAberta(em("2026-10-07T15:00:00Z"), k)).toBe(false); // 12h BRT
  });
  it("a janela de RESPOSTA (0495) segue a mesma regra: 22h–7h responde de madrugada", () => {
    const r = { ...k, windowStartHour: 7, windowEndHour: 22, respostaStartHour: 22, respostaEndHour: 7 };
    expect(janelaDeEnvioAberta(em("2026-10-07T06:00:00Z"), r, true)).toBe(true); // 3h BRT, resposta
    expect(janelaDeEnvioAberta(em("2026-10-07T06:00:00Z"), r, false)).toBe(false); // 3h BRT, disparo
  });
  it("fora dela, a próxima abertura é às 22h do mesmo dia", () => {
    const prox = proximaAberturaDaJanela(em("2026-10-07T15:00:00Z"), { ...k, jitterMaxMs: 0 }, false, () => 0);
    expect(prox.toISOString()).toBe("2026-10-08T01:00:00.000Z"); // 22h BRT
  });
});

// ─── 2. manifesto: cada regra tem um teste que a prova ───────────────────────

const POLITICA = "tests/invariants/politica-de-atendimento-por-etapa.test.ts";
const AGENTES = "tests/invariants/agentes-escola-configurados.test.ts";
const IDENTIDADE = "tests/unit/identidade-escolar-antes-do-agente.test.ts";
const TRAVA = "tests/unit/trava-global-de-envio.test.ts";

const MANIFESTO: ReadonlyArray<[string, ReadonlyArray<[string, string]>]> = [
  ["1 · aluno com casamento exato → acadêmico", [[IDENTIDADE, "B · aluno com pergunta acadêmica → agente acadêmico"], [AGENTES, "G · Alunos e responsáveis → o turno escolhe o acadêmico"]]],
  ["2 · aluno pergunta preço → continua acadêmico", [[IDENTIDADE, "C · aluno com pergunta COMERCIAL → continua acadêmico"], [AGENTES, "Q · aluno pergunta preço"]]],
  ["3 · comercial não atende Alunos", [[POLITICA, "G/M · Alunos e responsáveis → agente comercial recusado"], [AGENTES, "H · comercial em Alunos → recusado"]]],
  ["4 · acadêmico não atende etapa comercial", [[POLITICA, "→ comercial atende; acadêmico recusado"], [AGENTES, "I · acadêmico em Novo → recusado"]]],
  ["5 · aluno não sai de Alunos (qualquer escritor)", [[POLITICA, "mover para QUALQUER outra etapa é recusado pelo banco (PT423)"], [POLITICA, "trocar de funil também é saída, e é recusado"]]],
  ["6 · handoff acadêmico não move o card", [[AGENTES, "M · handoff do acadêmico: a conversa vai a humano, o card NÃO sai de Alunos"]]],
  ["7 · Equipe nunca recebe IA", [[POLITICA, "F/P · Equipe"], [AGENTES, "Equipe (humano)"]]],
  ["8 · Desqualificado nunca recebe IA", [[POLITICA, "E/O · Desqualificado"]]],
  ["9 · Desistiu nunca recebe IA", [[POLITICA, "D · Desistiu (lead fechado como perda) → nenhuma IA"]]],
  ["10 · follow-up só nas três etapas comerciais", [[POLITICA, "follow-up só em etapa comercial, em qualquer gatilho"]]],
  ["11 · funil Contatos não exige ganho", [[POLITICA, "R · nenhuma etapa is_won no funil, e ele funciona"]]],
  ["12 · Alunos não vira venda", [[POLITICA, "S · entrar em Alunos e responsáveis NÃO muda o lead para won"]]],
  ["13 · numero_contato2 não define parentesco", [[IDENTIDADE, "H · casou por numero_contato2"]]],
  ["14 · outro DDD não casa", [[IDENTIDADE, "G · colisão de outro DDD"]]],
  ["15 · API sem exact não casa", [[IDENTIDADE, "E · API antiga, sem match_type → desconhecido"]]],
  ["16 · timeout do Sistema Escolar fail-closed", [[IDENTIDADE, "F · timeout → desconhecido, não move"]]],
  ["17 · vários alunos não expõem nomes", [["tests/unit/atendimento-ao-aluno.test.ts", "T02 — dois alunos: ambíguo"]]],
  ["18 · prioridade nunca vence o escopo", [[AGENTES, "a prioridade nunca vence o escopo"], [AGENTES, "comercial 0 / acadêmico 10"]]],
  ["19 · before-send bloqueia escopo errado", [[IDENTIDADE, "J/M · escopo relido no beforeSend"]]],
  ["20 · turnos concorrentes não cruzam", [["tests/invariants/um-turno-por-contato.test.ts", "duas mensagens do MESMO contato"]]],
  ["21 · takeover humano cala a IA", [["tests/invariants/ia-silenciada-no-envio.test.ts", "'infinity' (Assumir, handoff) cala nas duas"], [AGENTES, "P · pessoa assumiu"]]],
  ["22-24 · só OUTBOUND_MESSAGING=enabled libera", [[TRAVA, "envioDeConversaLigado — só o literal `enabled` liga"]]],
  ["25 · nenhum emissor contorna a trava", [[TRAVA, "cada emissor conhecido chega ao canal por uma porta travada"], [TRAVA, "editar e apagar mensagem entregue também ficam atrás da trava"]]],
];

describe("manifesto — cada regra Capital Code tem uma prova viva", () => {
  it.each(MANIFESTO)("%s", (_regra, provas) => {
    for (const [arquivo, trecho] of provas) {
      expect(existsSync(arquivo), `arquivo da prova sumiu: ${arquivo}`).toBe(true);
      expect(readFileSync(arquivo, "utf8"), `${arquivo} não tem mais o teste «${trecho}»`).toContain(trecho);
    }
  });

  it("são 25 regras, nenhuma sem prova", () => {
    const numeros = MANIFESTO.flatMap(([r]) => {
      const [a, b] = r.split(" ")[0]!.split("-").map(Number);
      return b ? Array.from({ length: b - a! + 1 }, (_, i) => a! + i) : [a!];
    });
    expect(new Set(numeros).size).toBe(25);
  });
});
