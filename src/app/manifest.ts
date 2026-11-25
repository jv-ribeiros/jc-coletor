import type { MetadataRoute } from "next";

// App instalável: abre direto no coletor. Tela cheia é escolha do aparelho (Ajustes).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/coletor", name: "Coletor Lieto", short_name: "Coletor", start_url: "/coletor", scope: "/", display: "standalone",
    orientation: "portrait", background_color: "#273442", theme_color: "#273442", lang: "pt-BR",
    icons: [{ src: "/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
  };
}
