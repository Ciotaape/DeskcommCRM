"use client";
/**
 * Contador que gira — "Spinning counter" do transitions.dev. Cada dígito é um
 * tambor de 0 a 9 que roda até o alvo e pousa com mola; as colunas entram em
 * cascata de 90ms. Para número que é ACONTECIMENTO (a Visão geral abrindo).
 * Moeda, separadores e espaços ficam parados. CSS em `.ds-tambor`
 * (app/globals.css). Recebe o valor já formatado.
 *
 * O texto acessível é o valor inteiro (`aria-label`); os tambores são só
 * desenho.
 */
import { cn } from "@/lib/utils";

const DIGITOS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function ContadorQueGira({ valor, className }: { valor: string; className?: string }) {
  let coluna = 0;
  const total = [...valor].filter((c) => c >= "0" && c <= "9").length;
  return (
    <span className={cn("ds-tambor", className)} role="text" aria-label={valor}>
      {[...valor].map((c, i) => {
        if (c < "0" || c > "9") {
          return (
            <span key={i} aria-hidden="true" className="whitespace-pre">
              {c}
            </span>
          );
        }
        const alvo = Number(c);
        // A cascata corre da esquerda para a direita, mas com teto: um número
        // de oito dígitos não pode deixar o último chegando um segundo depois.
        const ordem = Math.min(coluna++, 6);
        return (
          <span key={i} aria-hidden="true" className="ds-tambor-coluna">
            <span className="ds-tambor-medida">0</span>
            <span
              className="ds-tambor-faixa"
              style={{
                ["--alvo" as string]: alvo,
                ["--coluna" as string]: ordem,
                ["--duracao" as string]: `${520 + alvo * 45 + (total > 4 ? 0 : 60)}ms`,
              }}
            >
              {DIGITOS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
