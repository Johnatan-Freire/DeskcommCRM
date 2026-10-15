# Sistema escolar — contrato v2 de `GET /api/deskcomm/aluno`

**Desde 14/10/2026.** Decisão da escola: o número de WhatsApp sozinho não libera dado
acadêmico. Lado Laravel: `app/Http/Controllers/Api/DeskcommAlunoController.php`
(repositório do sistema escolar). Lado CRM: `lib/integracoes/sistema-escolar.ts`
(`selecionarAluno`) e `lib/agent-engine/agent/consulta-do-aluno.ts`.

## Pedido

`GET /api/deskcomm/aluno?telefone=<dígitos>[&data_nascimento=AAAA-MM-DD]`, com `X-Api-Key`.

## Resposta

| `confirmacao` | Quando | `alunos` |
|---|---|---|
| `nao_informada` | sem `data_nascimento` | vazio — só `quantidade` |
| `confere` | a data bate com pelo menos um aluno do número | só os alunos cuja data confere |
| `nao_confere` | a data não bate com nenhum | vazio |
| `bloqueado` | 5 datas erradas para o número em 15 min | vazio (a data nem é checada) |

### Segundo fator (opcional — `DESKCOMM_CONFIRMACAO_POR_CODIGO=true` no Laravel, desligado por padrão)

Depois de a data conferir, um código de 6 dígitos vai ao **e-mail cadastrado** do aluno
(Job criptografado; só o hash fica no cache; uso único; validade `DESKCOMM_CODIGO_VALIDADE_MINUTOS`,
padrão 10). O CRM reenvia a consulta com `&codigo=`.

| `confirmacao` | Quando |
|---|---|
| `codigo_enviado` | data conferiu; código enviado (`email_mascarado` na resposta) |
| `codigo_invalido` | código errado ou expirado |
| `nome_necessario` | mais de um aluno com a mesma data (gêmeos): `&nome=` é conferido no Laravel, antes do código |
| `sem_canal_verificado` | aluno sem e-mail cadastrado — o CRM passa para a equipe |
| `bloqueado` | também: 3 envios ou 5 códigos errados por número em 15 min |

O contador de datas erradas CONTA antes de conferir (incremento atômico no cache `database`):
tentativas simultâneas não escapam do limite.

Número sem aluno continua `{"encontrado": false, "match_type": "exact", "alunos": []}`.
Data mal formada, inexistente, futura ou antes de 1900 → `422`, sem contar tentativa.
A data cadastrada **nunca** sai na resposta.

## Regras do CRM

- **Falha fechada:** resposta sem `confirmacao` (API anterior ao v2) é tratada como não
  confirmada (`api_sem_confirmacao`) — nenhum dado vai ao modelo, e a conversa passa para
  a equipe. Por isso a ordem dos deploys (CRM antes ou depois do Laravel) não abre brecha.
- A data sai do CRM só normalizada pelo código (`normalizarDataDeNascimento`).
- `bloqueado`, falha da consulta, casamento não exato e ambiguidade depois do nome
  completo passam a conversa para a equipe por código (não dependem do modelo).
- A identidade escolar (`decidirIdentidadeEscolar`) usa `quantidade`: relacionar o número
  a um aluno só move o card para a etapa acadêmica — nenhum dado sai sem a data.
