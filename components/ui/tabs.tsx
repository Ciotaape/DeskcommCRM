"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/**
 * A pílula deslizante do transitions.dev ("Tabs sliding"): um único elemento
 * que anda até a aba ativa (translate + width em 250ms) em vez de cada aba
 * acender o próprio fundo. A lista mede a aba ativa e escreve a posição em
 * custom properties; o CSS (`.ds-abas` em app/globals.css) faz o resto.
 *
 * Primeira medição e redimensionamento vão SEM transição (`data-pilula=
 * "sem-transicao"`), para a pílula nascer no lugar em vez de deslizar do canto.
 */
function usePilula(lista: React.RefObject<HTMLDivElement | null>) {
  React.useLayoutEffect(() => {
    const el = lista.current;
    if (!el) return;
    let primeira = true;
    let quadro = 0;

    const medir = (semTransicao: boolean) => {
      const ativa = el.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!ativa) {
        el.removeAttribute("data-pilula");
        return;
      }
      const caixa = el.getBoundingClientRect();
      const aba = ativa.getBoundingClientRect();
      if (aba.width === 0) return;
      el.style.setProperty("--pilula-x", `${aba.left - caixa.left + el.scrollLeft - el.clientLeft}px`);
      el.style.setProperty("--pilula-y", `${aba.top - caixa.top + el.scrollTop - el.clientTop}px`);
      el.style.setProperty("--pilula-w", `${aba.width}px`);
      el.style.setProperty("--pilula-h", `${aba.height}px`);
      if (semTransicao) {
        el.setAttribute("data-pilula", "sem-transicao");
        cancelAnimationFrame(quadro);
        quadro = requestAnimationFrame(() => {
          quadro = requestAnimationFrame(() => el.setAttribute("data-pilula", "ativa"));
        });
      } else {
        el.setAttribute("data-pilula", "ativa");
      }
    };

    medir(true);
    primeira = false;

    const mutacoes = new MutationObserver(() => medir(primeira));
    mutacoes.observe(el, { subtree: true, attributes: true, attributeFilter: ["data-state"], childList: true });
    const tamanho = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => medir(true));
    tamanho?.observe(el);

    return () => {
      cancelAnimationFrame(quadro);
      mutacoes.disconnect();
      tamanho?.disconnect();
    };
  }, [lista]);
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const interno = React.useRef<HTMLDivElement | null>(null);
  const juntar = React.useCallback(
    (no: HTMLDivElement | null) => {
      interno.current = no;
      if (typeof ref === "function") ref(no);
      else if (ref) ref.current = no;
    },
    [ref],
  );
  usePilula(interno);
  return (
    <TabsPrimitive.List
      ref={juntar}
      className={cn(
        "ds-abas inline-flex h-9 max-w-full items-center max-lg:h-auto justify-center-safe overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="ds-abas-pilula" />
      {children}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // `transition-[background-color,color,box-shadow]` em vez de
      // `transition-all`: o que muda ao ativar a aba é exatamente isto —
      // `data-[state=active]` troca fundo, cor do texto e sombra. `all` é
      // anti-pattern declarado em `docs/design-system/07-motion-language.md`,
      // e numa fila de abas ele ainda animava `width`/`padding` a cada troca.
      // Sombra e borda contam como um par pela própria exceção da lei.
      // `min-h-11 lg:min-h-0` — 44px de altura onde o dedo aciona.
      //
      // `px-3 py-1` em volta de `text-sm` dá **28px**, e a aba é o controle
      // mais repetido do produto: medido em 360px, 6 delas em Conexões, 2 em
      // Equipe, 2 em Atividades e 2 em Tarefas — todas na mesma altura curta.
      // Como a régua vale para TODA `TabsList`, o conserto aqui alcança as
      // quatro telas de uma vez, e as que já resolveram à mão (a fila do
      // Inbox) seguem com o delas, porque `cn` deixa o chamador vencer.
      //
      // `lg:` é o mesmo corte que `components/ui/button.tsx` usa para separar
      // "quem aciona é dedo" de "quem aciona é cursor".
      "inline-flex min-h-11 items-center justify-center rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm lg:min-h-0",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "ds-aba-conteudo mt-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
