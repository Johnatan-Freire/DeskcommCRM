/**
 * O DESFECHO da consulta ao sistema escolar, decidido em código — puro, sem banco.
 *
 * A ferramenta `consultar_aluno_sistema_escolar` (inbound-turn.ts) só aplica o que
 * esta função decide: devolver ao modelo uma resposta (com ou sem dado do aluno) ou
 * PASSAR A CONVERSA PARA A EQUIPE sem perguntar a ele.
 *
 * ## Por que a passagem não é do modelo (auditoria de 14/10/2026, R-06)
 *
 * Antes, toda falha voltava como "siga sem esse dado" e a passagem dependia de o
 * modelo obedecer ao prompt. Nos desfechos abaixo continuar com a IA é inventar ou
 * insistir, então o código decide:
 *
 *  - a consulta falhou (rede, HTTP, contrato);
 *  - a identidade ficou BLOQUEADA por tentativas de data de nascimento;
 *  - a API não tem o contrato de confirmação (anterior ao v2);
 *  - o sistema não confirmou que o número é de aluno (casamento não exato);
 *  - continua ambíguo DEPOIS de o nome completo ter sido informado.
 *
 * ## O que NUNCA sai daqui sem `encontrado`
 *
 * Nenhum desfecho além de `encontrado` carrega dado do aluno — nem nome, nem a
 * quantidade quando a identidade não foi confirmada.
 */
import type { AlunoSistemaEscolar, ResultadoSelecaoAluno } from '@/lib/integracoes/sistema-escolar';

export const MENSAGEM_PASSADO_PARA_EQUIPE =
  'a conversa foi passada para uma pessoa da equipe. Avise isso em uma frase curta, sem ' +
  'informar nenhum dado do aluno, e encerre o turno.';

export type DesfechoDaConsulta =
  | { acao: 'responder'; resposta: Record<string, unknown> }
  | { acao: 'passar_para_equipe'; porQue: string; resposta: Record<string, unknown> };

function passar(porQue: string, extra: Record<string, unknown> = {}): DesfechoDaConsulta {
  return {
    acao: 'passar_para_equipe',
    porQue,
    resposta: { ok: true, passado_para_equipe: true, message: MENSAGEM_PASSADO_PARA_EQUIPE, ...extra },
  };
}

export function desfechoDaConsultaDoAluno(
  selecao: ResultadoSelecaoAluno,
  nomeCompletoInformado: boolean,
): DesfechoDaConsulta {
  switch (selecao.status) {
    case 'nao_encontrado':
      return {
        acao: 'responder',
        resposta: {
          ok: true,
          encontrado: false,
          message:
            'nenhum aluno foi encontrado com o telefone desta conversa; não invente dados e ofereça passar para a equipe.',
        },
      };
    case 'correspondencia_nao_confirmada':
      return passar('o sistema escolar não confirmou que este número pertence a um aluno', { encontrado: false });
    case 'api_sem_confirmacao':
      return passar('o sistema escolar ainda não confirma identidade pela data de nascimento', { encontrado: false });
    case 'bloqueado':
      return passar('tentativas de confirmação de identidade esgotadas para este número', { encontrado: true });
    case 'confirmacao_necessaria':
      return {
        acao: 'responder',
        resposta: {
          ok: true,
          encontrado: true,
          confirmacao_necessaria: true,
          message:
            'há cadastro de aluno ligado a este número, mas nenhum dado pode ser informado antes da ' +
            'confirmação. Peça a data de nascimento do aluno (dia, mês e ano) e chame esta ferramenta ' +
            'de novo com data_nascimento. Não diga quantos alunos há nem nenhum nome.',
        },
      };
    case 'nao_confere':
      return {
        acao: 'responder',
        resposta: {
          ok: true,
          encontrado: true,
          confere: false,
          message:
            'a data de nascimento informada não confere com o cadastro. Diga apenas que não foi possível ' +
            'confirmar e peça para conferir a data do aluno. Não dê dica, não diga qual parte está errada.',
        },
      };
    case 'ambiguo':
      if (nomeCompletoInformado) {
        return passar('mais de um aluno corresponde ao número, à data e ao nome informados', { encontrado: true });
      }
      return {
        acao: 'responder',
        resposta: {
          ok: true,
          encontrado: true,
          ambiguo: true,
          message:
            'este telefone pertence a mais de um aluno; peça o nome completo e chame esta ferramenta ' +
            'novamente com nome_completo e a mesma data_nascimento.',
        },
      };
    case 'nome_nao_encontrado':
      return {
        acao: 'responder',
        resposta: {
          ok: true,
          encontrado: true,
          ambiguo: true,
          message:
            'o nome informado não corresponde exatamente a nenhum aluno confirmado; confira o nome completo, sem sugerir nomes.',
        },
      };
    case 'encontrado': {
      const aluno: AlunoSistemaEscolar = selecao.aluno;
      return { acao: 'responder', resposta: { ok: true, encontrado: true, ambiguo: false, aluno } };
    }
  }
}

/** A consulta lançou (rede, HTTP, contrato): passa para a equipe, nunca "siga sem o dado". */
export function desfechoDaFalhaDaConsulta(): DesfechoDaConsulta {
  return {
    acao: 'passar_para_equipe',
    porQue: 'o sistema escolar não respondeu à consulta do aluno',
    resposta: {
      ok: false,
      passado_para_equipe: true,
      error: { code: 'falha_consulta', message: MENSAGEM_PASSADO_PARA_EQUIPE },
    },
  };
}

/** Data que a pessoa escreveu e não é uma data de nascimento válida. */
export const RESPOSTA_DATA_INVALIDA: Record<string, unknown> = {
  ok: true,
  encontrado: false,
  message:
    'a data informada não é uma data de nascimento válida. Peça a data completa do aluno ' +
    '(dia, mês e ano com 4 dígitos), sem dar exemplo de data verdadeira.',
};
