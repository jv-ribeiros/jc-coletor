"use client";
// Coletor › Ajustes (engrenagem do início): tela cheia e instalação deste aparelho, e o atalho da gestão.
import Link from "next/link";
import { BotoesApp } from "@/components/instalar";
import { Tela } from "@/components/coletor";
import { usePode } from "@/components/topo";

export default function Ajustes() {
  const pode = usePode();
  return (
    <Tela titulo="Ajustes" sub="Deste aparelho">
      <BotoesApp />
      {pode(["gestao"]) && <Link href="/" className="bt2">Abrir a gestão</Link>}
    </Tela>
  );
}
