import type { Metadata } from "next"
import { notFound } from "next/navigation"
import CategoryPageClient from "./category-client"

interface Category {
  id: string
  name: string
  slug: string
  description?: string
}

async function getCategoryData(
  slug: string,
): Promise<{ category: Category; posts: any[]; categories: Category[] } | null> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/blog/category/${slug}`,
      {
        cache: "no-store",
      },
    )

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch (error) {
    console.error("Error fetching category data:", error)
    return null
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { slug } = params
  const data = await getCategoryData(slug)

  if (!data) {
    return {
      title: "Category Not Found - Affilova Blog",
      description: "The category you're looking for doesn't exist.",
    }
  }

  return {
    title: `${data.category.name} - Affilova Blog`,
    description: data.category.description || `Browse all posts in ${data.category.name} category`,
    openGraph: {
      title: `${data.category.name} - Affilova Blog`,
      description: data.category.description || `Browse all posts in ${data.category.name} category`,
    },
  }
}

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const { slug } = params
  const data = await getCategoryData(slug)

  if (!data) {
    notFound()
  }

  return <CategoryPageClient category={data.category} posts={data.posts} categories={data.categories} />
}
