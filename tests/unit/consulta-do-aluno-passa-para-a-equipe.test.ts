/**
 * A CONSULTA AO SISTEMA ESCOLAR PASSA PARA A EQUIPE POR CÓDIGO (auditoria 14/10/2026, R-06).
 *
 * Antes, falha da consulta voltava ao modelo como "siga sem esse dado" e a passagem
 * dependia de ele obedecer ao prompt. Aqui se prova a decisão (pura) e que o turno
 * a aplica: todo desfecho `passar_para_equipe` chama a passagem antes de responder.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  desfechoDaConsultaDoAluno,
  desfechoDaFalhaDaConsulta,
  MENSAGEM_PASSADO_PARA_EQUIPE,
} from "@/lib/agent-engine/agent/consulta-do-aluno";
import type { ResultadoSelecaoAluno } from "@/lib/integracoes/sistema-escolar";

const ALUNO = {
  nome: "Joana Ficticia Souza",
  situacao_financeira: "Em dia",
  matriculas: [],
};

describe("desfechos que passam para a equipe sem perguntar ao modelo", () => {
  it.each<[string, ResultadoSelecaoAluno, boolean]>([
    ["casamento não exato", { status: "correspondencia_nao_confirmada" }, false],
    ["API sem o contrato de confirmação", { status: "api_sem_confirmacao" }, false],
    ["identidade bloqueada por tentativas", { status: "bloqueado" }, false],
    ["segundo fator sem e-mail cadastrado", { status: "sem_canal_verificado" }, false],
    ["ambíguo DEPOIS do nome completo", { status: "ambiguo", quantidade: 2 }, true],
  ])("%s → passar_para_equipe", (_nome, selecao, nomeInformado) => {
    const d = desfechoDaConsultaDoAluno(selecao, nomeInformado);
    expect(d.acao).toBe("passar_para_equipe");
    if (d.acao !== "passar_para_equipe") return;
    expect(d.porQue.length).toBeGreaterThan(10);
    expect(d.resposta).toMatchObject({ passado_para_equipe: true, message: MENSAGEM_PASSADO_PARA_EQUIPE });
  });

  it("a consulta que lançou (rede/HTTP/contrato) passa — nunca 'siga sem esse dado'", () => {
    const d = desfechoDaFalhaDaConsulta();
    expect(d.acao).toBe("passar_para_equipe");
    expect(JSON.stringify(d)).not.toMatch(/siga sem/i);
  });
});

describe("desfechos que voltam ao modelo", () => {
  it.each<[string, ResultadoSelecaoAluno, boolean, RegExp]>([
    ["sem a data de nascimento", { status: "confirmacao_necessaria", quantidade: 2 }, false, /data de nascimento/],
    ["data que não confere", { status: "nao_confere" }, false, /não confere/],
    ["ambíguo antes do nome", { status: "ambiguo", quantidade: 2 }, false, /nome completo/],
    ["nome que não corresponde", { status: "nome_nao_encontrado" }, true, /confira o nome completo/],
    ["nenhum aluno no número", { status: "nao_encontrado" }, false, /não invente/],
    ["código enviado ao e-mail", { status: "codigo_enviado", emailMascarado: "j***@g***.com" }, false, /j\*\*\*@g\*\*\*\.com/],
    ["código que não confere", { status: "codigo_invalido" }, false, /não confere ou expirou/],
    ["gêmeos no segundo fator", { status: "nome_necessario" }, false, /nome completo/],
  ])("%s → responder", (_nome, selecao, nomeInformado, mensagem) => {
    const d = desfechoDaConsultaDoAluno(selecao, nomeInformado);
    expect(d.acao).toBe("responder");
    expect(String(d.resposta.message)).toMatch(mensagem);
  });

  it("⭐ só 'encontrado' carrega dado do aluno; nenhum outro desfecho diz quantos alunos há", () => {
    const todos: ResultadoSelecaoAluno[] = [
      { status: "nao_encontrado" },
      { status: "correspondencia_nao_confirmada" },
      { status: "api_sem_confirmacao" },
      { status: "bloqueado" },
      { status: "confirmacao_necessaria", quantidade: 3 },
      { status: "nao_confere" },
      { status: "ambiguo", quantidade: 3 },
      { status: "nome_nao_encontrado" },
      { status: "codigo_enviado", emailMascarado: null },
      { status: "codigo_invalido" },
      { status: "nome_necessario" },
      { status: "sem_canal_verificado" },
    ];
    for (const selecao of todos) {
      for (const nome of [false, true]) {
        const serializado = JSON.stringify(desfechoDaConsultaDoAluno(selecao, nome).resposta);
        expect(serializado).not.toContain('"aluno"');
        expect(serializado).not.toContain('"quantidade"');
        expect(serializado).not.toContain("3");
      }
    }
    const achou = desfechoDaConsultaDoAluno({ status: "encontrado", aluno: ALUNO }, false);
    expect(achou).toMatchObject({ acao: "responder", resposta: { aluno: { nome: "Joana Ficticia Souza" } } });
  });
});

describe("o turno aplica a decisão", () => {
  const fonte = readFileSync("lib/agent-engine/agent/inbound-turn.ts", "utf8");
  const inicio = fonte.indexOf("consultar_aluno_sistema_escolar: tool({");
  const fim = fonte.indexOf("consultar_catalogo_cursos: tool({", inicio);
  const executor = fonte.slice(inicio, fim);

  it("todo 'passar_para_equipe' chama a passagem antes de responder", () => {
    expect(inicio).toBeGreaterThan(0);
    expect(executor).toMatch(
      /if \(desfecho\.acao === 'passar_para_equipe'\) \{\s*await passarParaAEquipePeloSistema\(desfecho\.porQue\);\s*\}\s*return desfecho\.resposta;/,
    );
  });

  it("a falha da consulta vai pelo desfecho de falha (passagem), não por uma mensagem ad hoc", () => {
    expect(executor).toContain("desfecho = desfechoDaFalhaDaConsulta();");
    expect(executor).not.toMatch(/siga sem esse dado/);
  });

  it("a data de nascimento sai do CRM só normalizada pelo código", () => {
    expect(executor).toContain("normalizarDataDeNascimento(data_nascimento)");
    expect(executor).toMatch(/dataNascimento === undefined\s*\?\s*\{\}/);
    // código só segue se for 6 dígitos, e só junto da data
    expect(executor).toContain("/^\\d{6}$/u.test(codigo.trim())");
  });
});
