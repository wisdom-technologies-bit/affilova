import HomePageClient from "./HomePageClient"

export const metadata = {
  title: "Affilova - Affiliate Marketplace for Digital Products",
  description:
    "Affilova is a marketplace where vendors list products and affiliates earn a commission on the sales they refer.",
  keywords: "affiliate program, digital products, marketplace, earn commissions, sell online, affiliate marketing",
  openGraph: {
    title: "Affilova - Affiliate Marketplace for Digital Products",
    description: "Vendors list products, affiliates apply to promote them, and sales are tracked per product.",
    type: "website",
    url: "https://affilova.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "Affilova - Affiliate Marketplace",
    description: "Sell or promote digital products on Affilova.",
  },
}

export default function HomePage() {
  return <HomePageClient />
}
