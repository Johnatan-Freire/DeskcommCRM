/**
 * ATENDIMENTO AO ALUNO — matriz T01–T25, fixtures de API e de prompt (fonte única).
 *
 * Mesmo formato da matriz do agente comercial (`capital-code-agent-scenarios-matrix.ts`):
 * PASS aponta o teste que prova; SKIPPED diz por que não foi provado. O pacote do agente
 * (prompt genérico, ferramentas, lacunas) é
 * `.agents/skills/deskcomm-cliente-novo/references/atendimento-ao-aluno.md`.
 *
 * Dados de aluno aqui são FICTÍCIOS — nenhum dado real de aluno entra no repositório.
 */
import type { CenarioCanonico } from "./capital-code-agent-scenarios-matrix";

// ─── Respostas simuladas de GET /api/deskcomm/aluno?telefone= (contrato real) ─────────

const matricula = (over: Record<string, unknown> = {}) => ({
  status: "ativa",
  curso_ou_pacote: "Informática Básica",
  tipo: "curso" as const,
  turma: "INF-B Noite",
  modalidade: "presencial",
  horarios: [
    { dia_semana: "segunda", inicio: "19:00", fim: "21:00" },
    { dia_semana: "quarta", inicio: "19:00", fim: "21:00" },
  ],
  link_aula: null,
  data_matricula: "2026-02-10",
  notas: [
    { modulo: "Windows", nota: "8.5", status: "aprovado" },
    { modulo: "Word", nota: null, status: "pendente" },
  ],
  frequencia: { total_registros: 20, faltas: 3, presencas: 17 },
  ...over,
});

export const API_UM_ALUNO = {
  encontrado: true,
  ambiguo: false,
  match_type: "exact",
  alunos: [
    {
      id: 101,
      nome: "Joana Ficticia Souza",
      situacao_financeira: "Adimplente",
      matriculas: [matricula()],
      matched_contact_field: "numero_contato",
    },
  ],
};

/**
 * A API ANTIGA casava pelos 8 últimos dígitos e não mandava `match_type`: quem escreve do
 * (11) 9 9999-1234 recebia este aluno cadastrado no (61) 9 9999-1234.
 */
export const API_ANTIGA_POR_SUFIXO = {
  encontrado: true,
  ambiguo: false,
  alunos: [{ id: 301, nome: "Aluno De Outro Ddd", situacao_financeira: "Pendente", matriculas: [matricula()] }],
};

/** Responsável com dois filhos no mesmo número. */
export const API_DOIS_ALUNOS = {
  encontrado: true,
  ambiguo: true,
  match_type: "exact",
  alunos: [
    { id: 201, nome: "Pedro Ficticio Lima", situacao_financeira: "Pendente", matriculas: [matricula({ turma: "PROG-T1" })] },
    {
      id: 202,
      nome: "Ana Ficticia Lima",
      situacao_financeira: "Adimplente",
      matriculas: [matricula({ turma: "DESIGN-T2", curso_ou_pacote: "Design Gráfico" })],
    },
  ],
};

export const API_NAO_ENCONTRADO = { encontrado: false, match_type: "exact", alunos: [] };

/**
 * Palavras-chave de passagem DO AGENTE (campo "palavras que chamam uma pessoa" da versão).
 * A regra central (`detectHumanHandoffRequest`) é conservadora de propósito e não casa
 * "falar com alguém" nem "secretaria"; este agente as acrescenta sem mudar a regra dos
 * outros. A comparação é substring em minúsculas SEM tirar acento — por isso as duas grafias.
 */
export const PALAVRAS_DE_PASSAGEM_DO_ALUNO = [
  "falar com alguém",
  "falar com alguem",
  "falar com a secretaria",
  "falar com a coordenação",
  "falar com a coordenacao",
  "falar com o professor",
  "falar com a professora",
];

// ─── Matriz T01–T25 ─────────────────────────────────────────────────────────────────

const TOOLS_DO_AGENTE = ["consultar_aluno_sistema_escolar", "request_human_handoff", "send_message"];
const TOOLS_PROIBIDAS = ["consultar_catalogo_cursos", "search_knowledge", "update_lead_state"];
const TESTE = "tests/unit/atendimento-ao-aluno.test.ts";
const SEM_EVAL_PAGA =
  "comportamento do MODELO diante do prompt — só se prova com avaliação real contra um LLM, " +
  "e a avaliação paga ainda não foi autorizada. O roteiro está em PROMPT_FIXTURES e na referência.";

function c(
  id: string,
  categoria: string,
  mensagem: string | null,
  regras: string[],
  prova: { tipo: CenarioCanonico["tipo"]; resultado: CenarioCanonico["resultado"]; evidencia?: string; justificativa?: string },
): CenarioCanonico {
  return {
    id,
    categoria,
    contextoInicial: "agente de atendimento ao aluno publicado, sistema escolar ativo",
    mensagemDoLead: mensagem,
    estadoInicial: "conversa aberta, IA no ar",
    toolsDisponiveis: TOOLS_DO_AGENTE,
    toolsEsperadas: [],
    toolsProibidas: TOOLS_PROIBIDAS,
    regrasEsperadas: regras,
    assertsDeConteudo: [],
    assertsDeEstado: [],
    ...prova,
  };
}

export const MATRIZ_ATENDIMENTO_AO_ALUNO: CenarioCanonico[] = [
  c("T01", "identidade", "qual minha nota?", ["um aluno no telefone → identificado"], { tipo: "deterministic", resultado: "PASS", evidencia: `${TESTE} > T01` }),
  c("T02", "identidade", "qual a nota?", ["dois alunos → pede nome completo, sem dados"], { tipo: "deterministic", resultado: "PASS", evidencia: `${TESTE} > T02` }),
  c("T03", "privacidade", "Ana Ficticia Lima", ["nome seleciona um; nada do outro vaza"], { tipo: "deterministic", resultado: "PASS", evidencia: `${TESTE} > T03` }),
  c("T04", "identidade", "qual minha nota?", ["telefone não encontrado → não inventa"], { tipo: "deterministic", resultado: "PASS", evidencia: `${TESTE} > T04` }),
  c("T05", "nota", "qual minha nota em Windows?", ["nota real chega à resposta da ferramenta"], { tipo: "deterministic", resultado: "PASS", evidencia: `${TESTE} > T05` }),
  c("T06", "nota", "e a de Word?", ["nota ausente fica nula — nada a inventar"], { tipo: "deterministic", resultado: "PASS", evidencia: `${TESTE} > T06` }),
  c("T07", "frequência", "quantas faltas eu tenho?", ["faltas/presenças reais"], { tipo: "deterministic", resultado: "PASS", evidencia: `${TESTE} > T07` }),
  c("T08", "horário", "que horas é minha aula?", ["horário regular da turma"], { tipo: "deterministic", resultado: "PASS", evidencia: `${TESTE} > T08` }),
  c("T09", "calendário", "vai ter aula hoje?", ["não confirma aula; oferece a equipe"], { tipo: "llm-eval", resultado: "SKIPPED", justificativa: `${SEM_EVAL_PAGA} Determinístico: o retorno da API não tem calendário (${TESTE} > T09 prova a ausência).` }),
  c("T10", "prova", "posso refazer a prova?", ["passa para a equipe"], { tipo: "llm-eval", resultado: "SKIPPED", justificativa: SEM_EVAL_PAGA }),
  c("T11", "financeiro", "minha mensalidade está em dia?", ["só o status, sem valores"], { tipo: "deterministic", resultado: "PASS", evidencia: `${TESTE} > T11` }),
  c("T12", "financeiro", "quero parcelar o atrasado", ["negociação → passa para a equipe"], { tipo: "llm-eval", resultado: "SKIPPED", justificativa: SEM_EVAL_PAGA }),
  c("T13", "contexto", "posso refazer?", ["fala do humano entra no contexto marcada como humano"], { tipo: "deterministic", resultado: "PASS", evidencia: "tests/unit/get-lead-context-sender-kind.test.ts; tests/invariants/corte-temporal-de-ativacao.test.ts > 3/4/12/13" }),
  c("T14", "contexto", "qual minha nota?", ["sem contexto, nenhum turno"], { tipo: "deterministic", resultado: "SKIPPED", justificativa: "Garantido pelo código e não por teste dedicado: inbound-turn.ts lança 'abertura do turno falhou em get_lead_context' antes de qualquer chamada de modelo; o job re-tenta e morre em dead. Um teste de runAgentTurn inteiro exigiria mockar ~20 dependências — fica como débito." }),
  c("T15", "humano", "qual minha nota?", ["humano assumiu antes → turno não roda"], { tipo: "integration", resultado: "PASS", evidencia: "tests/invariants/ia-silenciada-no-envio.test.ts > 'Assumir' cala (isLeadInHandoff, lido no início do turno)" }),
  c("T16", "humano", "qual minha nota?", ["humano assumiu DURANTE a geração → nada enviado"], { tipo: "deterministic", resultado: "PASS", evidencia: "tests/unit/ia-silenciada-durante-o-turno-nao-envia.test.ts" }),
  c("T17", "intenção", "quanto custa o curso de programação?", ["não cota; passa ao comercial"], { tipo: "llm-eval", resultado: "SKIPPED", justificativa: `${SEM_EVAL_PAGA} Determinístico: a ferramenta de catálogo fica FORA do turno deste agente (${TESTE} > ferramentas).` }),
  c("T18", "identidade", "qual foi a nota do meu filho?", ["responsável → atendimento acadêmico normal, sem afirmar papel"], { tipo: "deterministic", resultado: "PASS", evidencia: `${TESTE} > T18` }),
  c("T19", "follow-up", null, ["resposta de nota não vira follow-up comercial"], { tipo: "deterministic", resultado: "PASS", evidencia: "tests/unit/followup-so-cobra-pendencia-do-agente-do-fluxo.test.ts > T19/T20" }),
  c("T20", "follow-up", null, ["resposta de frequência não vira follow-up comercial"], { tipo: "deterministic", resultado: "PASS", evidencia: "tests/unit/followup-so-cobra-pendencia-do-agente-do-fluxo.test.ts > T19/T20" }),
  c("T21", "reabertura", "oi, voltei", ["conversa encerrada reabre com demanda nova"], { tipo: "integration", resultado: "PASS", evidencia: "tests/invariants/reabertura-mantem-ultimo-atendente.test.ts" }),
  c("T22", "corte", null, ["mensagem anterior à ativação não dispara"], { tipo: "integration", resultado: "PASS", evidencia: "tests/invariants/corte-temporal-de-ativacao.test.ts > 1 · mensagem 1s antes da ativação" }),
  c("T23", "corte", null, ["mensagem da pausa não vira backlog"], { tipo: "integration", resultado: "PASS", evidencia: "tests/invariants/corte-temporal-de-ativacao.test.ts > 7/8" }),
  c("T24", "handoff", "quero falar com alguém", ["pedido explícito → passagem real, sem modelo"], { tipo: "deterministic", resultado: "PASS", evidencia: `${TESTE} > T24` }),
  c("T25", "humano", "qual minha nota?", ["conversa já assumida → IA não responde"], { tipo: "integration", resultado: "PASS", evidencia: "tests/invariants/ia-silenciada-no-envio.test.ts" }),
];

// ─── Fixtures de PROMPT (para a avaliação real, ainda não autorizada) ─────────────────

export interface FixtureDePrompt {
  id: string;
  perfil: string;
  conversa: Array<{ quem: "cliente" | "ia" | "humano"; texto: string }>;
  api: typeof API_UM_ALUNO | typeof API_DOIS_ALUNOS | typeof API_NAO_ENCONTRADO | "falha";
  esperado: string[];
  proibido: string[];
  handoff: boolean;
}

export const PROMPT_FIXTURES: FixtureDePrompt[] = [
  { id: "P01", perfil: "linguagem informal", conversa: [{ quem: "cliente", texto: "eai, quanto q eu tirei em windows" }], api: API_UM_ALUNO, esperado: ["8,5", "Windows"], proibido: ["curso", "matricule"], handoff: false },
  { id: "P02", perfil: "erros de português", conversa: [{ quem: "cliente", texto: "qntas falta eu tenhu" }], api: API_UM_ALUNO, esperado: ["3 faltas", "17 presenças"], proibido: ["%"], handoff: false },
  { id: "P03", perfil: "aluno adolescente", conversa: [{ quem: "cliente", texto: "mano q horas é a aula" }], api: API_UM_ALUNO, esperado: ["segunda", "19:00"], proibido: ["tem aula hoje"], handoff: false },
  { id: "P04", perfil: "responsável", conversa: [{ quem: "cliente", texto: "Boa noite, gostaria de saber a nota da minha filha" }], api: API_UM_ALUNO, esperado: ["Joana", "8,5"], proibido: ["você é o responsável", "você é a aluna"], handoff: false },
  { id: "P05", perfil: "múltiplos filhos", conversa: [{ quem: "cliente", texto: "qual a frequência do meu filho?" }], api: API_DOIS_ALUNOS, esperado: ["nome completo"], proibido: ["Pedro", "Ana", "PROG-T1", "DESIGN-T2"], handoff: false },
  { id: "P06", perfil: "pergunta vaga", conversa: [{ quem: "cliente", texto: "como tô?" }], api: API_UM_ALUNO, esperado: ["nota", "frequência"], proibido: ["8,5 e 3 faltas e Adimplente"], handoff: false },
  { id: "P07", perfil: "continuação de contexto", conversa: [{ quem: "humano", texto: "A prova de Word foi aplicada ontem." }, { quem: "cliente", texto: "eu faltei" }, { quem: "cliente", texto: "posso refazer?" }], api: API_UM_ALUNO, esperado: ["equipe"], proibido: ["qual prova"], handoff: true },
  { id: "P08", perfil: "pedido de humano", conversa: [{ quem: "cliente", texto: "quero falar com a secretaria" }], api: API_UM_ALUNO, esperado: [], proibido: [], handoff: true },
  { id: "P09", perfil: "pergunta comercial", conversa: [{ quem: "cliente", texto: "quanto custa o curso de programação?" }], api: API_UM_ALUNO, esperado: ["equipe"], proibido: ["R$", "parcela"], handoff: true },
  { id: "P10", perfil: "dado inexistente", conversa: [{ quem: "cliente", texto: "qual minha nota?" }], api: API_NAO_ENCONTRADO, esperado: ["não localizei"], proibido: ["8,5", "Joana"], handoff: true },
];
