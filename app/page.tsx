import HomePageClient from "./HomePageClient"

export const metadata = {
  title: "Affilova - Affiliate Marketplace for Digital Products | Build Your Empire",
  description:
    "Build your affiliate empire with Affilova. Connect with top-performing affiliates, manage digital products, automate sales funnels, and earn competitive commissions.",
  keywords: "affiliate program, digital products, marketplace, earn commissions, sell online, affiliate marketing",
  openGraph: {
    title: "Affilova - Affiliate Marketplace for Digital Products",
    description: "Connect with thousands of affiliates and scale your business on Affilova's premier marketplace.",
    type: "website",
    url: "https://affilova.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "Affilova - Affiliate Marketplace",
    description: "Build your affiliate empire",
  },
}

export default function HomePage() {
  return <HomePageClient />
}
