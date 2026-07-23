import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lattice Lab — Componentes",
  description: "Preview isolado de componentes, variações e validações do Lattice.",
  openGraph: {
    title: "Lattice Lab",
    description: "Componentes · Variações · Validações",
    images: ["/lab-og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lattice Lab",
    description: "Componentes · Variações · Validações",
    images: ["/lab-og.png"],
  },
};

export default function LabLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
