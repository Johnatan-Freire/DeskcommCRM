---
impacto: capacidade_nova
secao: adicionado
titulo: Tempo na etapa (quem está nela agora) na tela de etapas, medido por stage_changed_at (#2032)
---

A tela de etapas passa a mostrar, ao lado da taxa histórica de ganho (#1753), quanto tempo os negócios estão NA etapa AGORA — medido pela ENTRADA do negócio na etapa (`crm_leads.stage_changed_at`, carimbada pelo trigger `trg_stamp_stage_changed_at` desde a migration 0071), com `created_at` de reserva para o lead sem carimbo. `last_activity_at` não entra na conta: é tempo sem resposta, e uma nota na conversa zerava o relógio de um negócio parado há semanas. É a mesma escolha do card do Kanban desde o #1908.

Quem entrega o número é `lib/metrics/tempo-da-etapa.ts` (puro, relógio injetado), publicado pela rota `GET /api/v1/pipelines/{id}/stages/win-rates` no bloco `tempo_na_etapa`, com `medida` e `base` escritos na resposta: a taxa ao lado é de OUTRA população (quem passou pela janela de dias, reconstruída das atividades `stage_changed`) e as duas não se somam. Por etapa saem quantidade, média e mediana de horas, além da amostra `com_carimbo`/`sem_carimbo` — número medido sobre reserva não é número medido sobre carimbo. Ganho e perda não recebem a frase: lá a coluna não segura trabalho em curso.

Sete testes do módulo cobrem os três casos da issue, inclusive o de `last_activity_at` mais recente ser ignorado; a rota e a tela têm teste próprio, e etapa vazia não ganha «0 h».

Contribuição de @webtecnica (#2032).
