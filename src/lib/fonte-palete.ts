// Fonte da folha dos paletes: Roboto Condensed (Google, licença Apache 2.0), a de placa de armazém.
// Vai junto com o app para o coletor imprimir igual ao desenho aprovado (design/pages/folha-palete_v4.html), sem depender do aparelho.
// Uso: a classe `variable` num ancestral define --font-palete, que o CSS da folha (.fpal .fo) usa.
import localFont from "next/font/local";

export const fontePalete = localFont({
  src: [
    { path: "../fonts/RobotoCondensed-Bold.ttf", weight: "700", style: "normal" },
    { path: "../fonts/RobotoCondensed-Regular.ttf", weight: "400", style: "normal" },
  ],
  variable: "--font-palete",
  display: "block",
  fallback: ["Arial Narrow", "sans-serif"],
});
