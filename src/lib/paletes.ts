// Folha dos paletes: divisão da produção em paletes (N cheios pela montagem do cadastro, camadas × caixas por camada, + a sobra)
// e a validade digitada no coletor. Usado no coletor (botão "Folhas dos paletes · 3 + sobra") e na tela de impressão.
import { r4 } from "@/lib/client";

export type Folha = { n: number; qtd: number; sobra: boolean };

export function dividir(qtd: number, por: number) {
  if (!(qtd > 0) || !(por > 0)) return { cheios: 0, sobra: 0, folhas: [] as Folha[] };
  const cheios = Math.floor(r4(qtd / por) + 1e-9), sobra = r4(qtd - cheios * por);
  const folhas: Folha[] = Array.from({ length: Math.min(cheios, 500) }, (_, k) => ({ n: k + 1, qtd: por, sobra: false }));
  if (sobra > 0) folhas.push({ n: 0, qtd: sobra, sobra: true });
  return { cheios, sobra, folhas };
}

// "3 + sobra", "3 paletes", "1 incompleto"
export function resumo(qtd: number, por: number) {
  const { cheios, sobra } = dividir(qtd, por);
  if (!cheios) return sobra ? "1 incompleto" : "";
  return `${cheios}${sobra ? " + sobra" : cheios === 1 ? " palete" : " paletes"}`;
}

// ---------- validade ----------
// Digita-se só números (o teclado numérico do coletor não tem barra); a máscara põe as barras.
// 8 dígitos = dia/mês/ano. 6 dígitos = mês/ano (03/2028) quando o 3º e o 4º são "20" (mês 20 não existe),
// senão dia/mês/ano com o ano em 2 dígitos (26/11/28).
const mesAno = (d: string) => d.length === 6 && d.slice(2, 4) === "20";

export function mascaraValidade(s: string) {
  const d = s.replace(/\D/g, "").slice(0, 8);
  if (mesAno(d)) return `${d.slice(0, 2)}/${d.slice(2)}`;
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

// "26/11/2028" → "2028-11-26"; "03/2028" → "2028-03"; "26/11/28" → "2028-11-26". Incompleta ou inválida → null.
export function validadeIso(texto: string): string | null {
  const d = texto.replace(/\D/g, "");
  let dia = 0, mes = 0, ano = 0;
  if (d.length === 8) [dia, mes, ano] = [+d.slice(0, 2), +d.slice(2, 4), +d.slice(4)];
  else if (mesAno(d)) [mes, ano] = [+d.slice(0, 2), +d.slice(2)];
  else if (d.length === 6) [dia, mes, ano] = [+d.slice(0, 2), +d.slice(2, 4), 2000 + +d.slice(4)];
  else return null;
  if (mes < 1 || mes > 12 || ano < 2000 || ano > 2100) return null;
  const mm = String(mes).padStart(2, "0");
  if (!dia) return `${ano}-${mm}`;
  if (new Date(Date.UTC(ano, mes - 1, dia)).getUTCDate() !== dia) return null;
  return `${ano}-${mm}-${String(dia).padStart(2, "0")}`;
}

// "2028-11-26" → "26/11/2028"; "2028-03" → "03/2028"
export const validadeTexto = (iso: string) => iso.split("-").reverse().join("/");

// já passou? (mês/ano vale até o fim do mês)
export const validadeVencida = (iso: string, hoje: string) => iso < hoje.slice(0, iso.length);
