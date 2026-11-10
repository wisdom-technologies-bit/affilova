import type { Metadata } from "next"
import { notFound } from "next/navigation"
import BlogPostClient from "./blog-post-client"

interface BlogPost {
  id: string
  title: string
  slug: string
  content: string
  excerpt: string
  image_url?: string
  hero_image_url?: string
  published_at: string
  category_name?: string
  category_slug?: string
  author_name?: string
  author_avatar?: string
  read_count?: number
  comment_count?: number
  average_rating?: number
  rating_count?: number
}

async function getBlogPost(slug: string): Promise<BlogPost | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/blog/${slug}`, {
      cache: "no-store",
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.post
  } catch (error) {
    console.error("Error fetching blog post:", error)
    return null
  }
}

async function getPopularPosts(): Promise<BlogPost[]> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/blog`, {
      cache: "no-store",
    })

    if (!response.ok) {
      return []
    }

    const data = await response.json()
    return data.popularPosts || []
  } catch (error) {
    console.error("Error fetching popular posts:", error)
    return []
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { slug } = params
  const post = await getBlogPost(slug)

  if (!post) {
    return {
      title: "Blog Post Not Found",
      description: "The blog post you're looking for doesn't exist.",
    }
  }

  return {
    title: `${post.title} - Affilova Blog`,
    description: post.excerpt || post.content.substring(0, 160),
    openGraph: {
      title: post.title,
      description: post.excerpt || post.content.substring(0, 160),
      images: post.hero_image_url || post.image_url ? [{ url: post.hero_image_url || post.image_url }] : [],
    },
  }
}

export default async function BlogPostPage({ params }: { params: { slug: string } }) {
  const { slug } = params
  const [post, popularPosts] = await Promise.all([getBlogPost(slug), getPopularPosts()])

  if (!post) {
    notFound()
  }

  return <BlogPostClient post={post} popularPosts={popularPosts} />
}
