"use client";
/**
 * Número que salta quando muda — "Number pop-in" do transitions.dev. Para
 * contadores que precisam ser NOTADOS (fila, tarefas, casos no menu). Os
 * dígitos iniciais que o número velho e o novo compartilham ficam parados; os
 * que mudaram trocam com mola, os dois últimos atrasados 1× e 2× o passo.
 * CSS em `.ds-salta` (app/globals.css). Recebe o valor já formatado.
 */
import { useState } from "react";

import { cn } from "@/lib/utils";

const ehDigito = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

export function NumeroSalta({ valor, className }: { valor: string; className?: string }) {
  const [estado, setEstado] = useState({ atual: valor, anterior: valor, rodada: 0 });
  if (estado.atual !== valor) {
    setEstado({ atual: valor, anterior: estado.atual, rodada: estado.rodada + 1 });
  }
  const { atual, anterior, rodada } = estado;

  let iguais = 0;
  while (iguais < atual.length && iguais < anterior.length && atual[iguais] === anterior[iguais]) iguais++;

  return (
    <span key={rodada} className={cn("ds-salta", rodada > 0 && "anima", className)}>
      {[...atual].map((c, i) => {
        if (rodada === 0 || i < iguais || !ehDigito(c)) {
          return (
            <span key={i} className="ds-salta-digito" data-igual="">
              {c}
            </span>
          );
        }
        const doFim = atual.length - 1 - i;
        const atraso = doFim === 1 ? 1 : doFim === 0 ? 2 : 0;
        const velho = anterior[anterior.length - (atual.length - i)];
        return (
          <span key={i} className="ds-salta-casa" style={{ ["--digit-i" as string]: atraso }}>
            {ehDigito(velho) && (
              <span className="ds-salta-velho" aria-hidden="true">
                {velho}
              </span>
            )}
            <span className="ds-salta-digito">{c}</span>
          </span>
        );
      })}
    </span>
  );
}
