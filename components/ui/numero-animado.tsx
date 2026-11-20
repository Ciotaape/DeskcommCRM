"use client";
/**
 * Número que muda sem chamar atenção — "Number subtle change" do
 * transitions.dev. Só os dígitos que mudaram trocam: o antigo sai e o novo
 * entra, subindo quando o valor sobe e descendo quando cai. O resto do texto
 * (moeda, separadores, sufixos) fica parado. CSS em `.ds-numero`
 * (app/globals.css).
 *
 * Recebe o valor JÁ FORMATADO: a formatação (moeda, locale) é de quem chama.
 */
import { useState } from "react";

import { ContadorQueGira } from "@/components/ui/contador-que-gira";

import { cn } from "@/lib/utils";

function paraNumero(texto: string): number {
  const limpo = texto.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? n : 0;
}

const ehDigito = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/**
 * `girarAoAbrir`: na primeira pintura o número roda nos tambores (Spinning
 * counter) — é o momento orquestrado da tela. Daí em diante, cada mudança é a
 * troca discreta só dos dígitos que mudaram.
 */
export function NumeroAnimado({
  valor,
  className,
  girarAoAbrir = false,
}: {
  valor: string;
  className?: string;
  girarAoAbrir?: boolean;
}) {
  const [estado, setEstado] = useState({ atual: valor, anterior: valor, rodada: 0 });
  if (estado.atual !== valor) {
    setEstado({ atual: valor, anterior: estado.atual, rodada: estado.rodada + 1 });
  }

  const { atual, anterior, rodada } = estado;
  if (girarAoAbrir && rodada === 0) return <ContadorQueGira valor={atual} className={className} />;
  const dir = paraNumero(atual) >= paraNumero(anterior) ? 1 : -1;
  const deslocamento = anterior.length - atual.length;

  return (
    <span
      key={rodada}
      className={cn("ds-numero", rodada > 0 && "anima", className)}
      style={{ ["--dir" as string]: dir }}
    >
      {[...atual].map((c, i) => {
        const velho = anterior[i + deslocamento];
        if (rodada > 0 && ehDigito(c) && velho !== c && (ehDigito(velho) || velho === undefined)) {
          return (
            <span key={i} className="ds-numero-casa">
              {velho !== undefined && (
                <span className="ds-numero-velho" aria-hidden="true">
                  {velho}
                </span>
              )}
              <span className="ds-numero-novo">{c}</span>
            </span>
          );
        }
        return <span key={i}>{c}</span>;
      })}
    </span>
  );
}
