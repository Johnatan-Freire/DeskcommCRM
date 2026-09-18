"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { ConfigSeguraSistemaEscolar } from "@/lib/integracoes/sistema-escolar-config";

const formSchema = z.object({
  base_url: z.string().trim().url("URL inválida").max(300),
  api_key: z.string().trim().max(500),
  is_active: z.boolean(),
});

interface PutResponse {
  data: {
    config: ConfigSeguraSistemaEscolar;
    teste_de_conexao: { ok: boolean; erro?: string };
  };
}

interface Props {
  initialConfig: ConfigSeguraSistemaEscolar;
  canWrite: boolean;
}

export function SistemaEscolarForm({ initialConfig, canWrite }: Props) {
  const router = useRouter();
  const [config, setConfig] = useState(initialConfig);
  const [baseUrl, setBaseUrl] = useState(initialConfig.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [isActive, setIsActive] = useState(initialConfig.is_active);
  const [errors, setErrors] = useState<{ base_url?: string; api_key?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const parsed = formSchema.safeParse({ base_url: baseUrl, api_key: apiKey, is_active: isActive });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setErrors({ base_url: flat.base_url?.[0], api_key: flat.api_key?.[0] });
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient.put<PutResponse>("/api/v1/settings/sistema-escolar", {
        base_url: parsed.data.base_url,
        api_key: parsed.data.api_key.length > 0 ? parsed.data.api_key : undefined,
        is_active: parsed.data.is_active,
      });
      setConfig(res.data.config);
      setApiKey("");
      if (!isActive) {
        toast.success("Configuração salva. Ative para testar a conexão.");
      } else if (res.data.teste_de_conexao.ok) {
        toast.success("Configuração salva — conexão testada com sucesso.");
      } else {
        toast.warning("Configuração salva, mas o teste de conexão falhou.", {
          description: res.data.teste_de_conexao.erro,
        });
      }
      router.refresh();
    } catch (err) {
      showApiError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.delete("/api/v1/settings/sistema-escolar");
      toast.success("Integração removida.");
      setDeleteOpen(false);
      setConfig({ configurado: false, base_url: null, api_key_last4: null, is_active: false, updated_at: null });
      setBaseUrl("");
      setApiKey("");
      setIsActive(false);
      router.refresh();
    } catch (err) {
      showApiError(err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="max-w-xl space-y-5 p-6">
      {config.configurado && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={config.is_active ? "default" : "outline"}>
            {config.is_active ? "Ativa" : "Desativada"}
          </Badge>
          <span>
            Chave atual termina em <span className="font-mono">…{config.api_key_last4}</span>
          </span>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="se-base-url">URL base da API</Label>
          <Input
            id="se-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://sistema.capitalcode.com.br"
            disabled={!canWrite}
            required
          />
          {errors.base_url && <p className="text-xs text-destructive">{errors.base_url}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="se-api-key">Chave de API</Label>
          <Input
            id="se-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config.configurado ? "Deixe em branco para manter a chave atual" : "Obrigatória na primeira configuração"}
            autoComplete="off"
            disabled={!canWrite}
          />
          {errors.api_key && <p className="text-xs text-destructive">{errors.api_key}</p>}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="se-is-active">Integração ativa</Label>
            <p className="text-xs text-muted-foreground">
              Desativada, os agentes deixam de oferecer consulta ao sistema escolar.
            </p>
          </div>
          <Switch
            id="se-is-active"
            checked={isActive}
            onCheckedChange={setIsActive}
            disabled={!canWrite}
          />
        </div>

        {canWrite && (
          <div className="flex items-center justify-between pt-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Salvando…" : "Salvar"}
            </Button>
            {config.configurado && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={submitting}
                onClick={() => setDeleteOpen(true)}
              >
                Remover integração
              </Button>
            )}
          </div>
        )}
      </form>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover integração com o sistema escolar?</AlertDialogTitle>
            <AlertDialogDescription>
              Os agentes &ldquo;Alunos&rdquo; e &ldquo;Interessados&rdquo; deixam de conseguir
              consultar matrícula, notas e catálogo de cursos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={deleting}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
