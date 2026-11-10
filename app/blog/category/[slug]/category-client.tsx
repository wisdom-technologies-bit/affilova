"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Menu, X, ChevronDown, Eye, MessageCircle, Star, ArrowLeft, Grid3X3, List, Tag } from "lucide-react"
import GlobalFooter from "@/components/global-footer"

interface BlogPost {
  id: string
  title: string
  slug: string
  excerpt: string
  image_url?: string
  hero_image_url?: string
  published_at: string
  category_name?: string
  category_slug?: string
  author_name?: string
  read_count?: number
  comment_count?: number
  average_rating?: number
}

interface Category {
  id: string
  name: string
  slug: string
  description?: string
}

interface CategoryPageClientProps {
  category: Category
  posts: BlogPost[]
  categories: Category[]
}

export default function CategoryPageClient({ category, posts, categories }: CategoryPageClientProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return "Today"
    if (diffDays === 1) return "Yesterday"
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center space-x-2">
            <img src="/affilova-logo.png" alt="Affilova" className="h-10 w-auto" />
          </Link>
          <div className="hidden md:flex items-center space-x-4">
            <Link href="/blog">
              <Button variant="ghost" className="text-gray-600">
                <ArrowLeft className="w-4 h-4 mr-2" />
                All Posts
              </Button>
            </Link>
            <Link href="/auth/login">
              <Button variant="ghost" className="text-gray-600">
                Sign In
              </Button>
            </Link>
          </div>
          <button className="md:hidden p-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="md:hidden bg-white border-b px-4 py-4 space-y-2">
          <Link href="/" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
            Home
          </Link>
          <Link href="/blog" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
            All Posts
          </Link>
          <Link href="/auth/login" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
            Sign In
          </Link>
        </div>
      )}

      {/* Hero Section */}
      <section className="py-12 md:py-20 px-4 bg-gradient-to-br from-green-600 via-green-500 to-emerald-600 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-64 h-64 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-10 left-10 w-80 h-80 bg-white rounded-full blur-3xl" />
        </div>
        <div className="container mx-auto max-w-4xl relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-5 h-5" />
            <span className="text-sm uppercase tracking-wider opacity-80">Category</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-4">{category.name}</h1>
          {category.description && <p className="text-lg md:text-xl opacity-90 max-w-2xl">{category.description}</p>}
          <div className="mt-6 flex items-center gap-4">
            <span className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full text-sm">
              {posts.length} {posts.length === 1 ? "post" : "posts"}
            </span>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 md:py-12 flex flex-col lg:flex-row gap-8 lg:gap-12 flex-1">
        {/* Sidebar - Desktop */}
        <aside className="hidden lg:block w-56 flex-shrink-0">
          <div className="sticky top-24">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 uppercase">All Categories</h3>
            <div className="space-y-2">
              <Link
                href="/blog"
                className="block w-full text-left px-3 py-2 rounded-lg transition text-sm text-gray-600 hover:bg-gray-100"
              >
                All Posts
              </Link>
              {categories.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/blog/category/${cat.slug}`}
                  className={`block w-full text-left px-3 py-2 rounded-lg transition text-sm ${
                    cat.slug === category.slug
                      ? "bg-green-100 text-green-700 font-medium"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {cat.name}
                </Link>
              ))}
            </div>
          </div>
        </aside>

        {/* Mobile Category Dropdown */}
        <div className="lg:hidden relative">
          <button
            onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border"
          >
            <span className="font-medium text-gray-900">{category.name}</span>
            <ChevronDown className={`w-5 h-5 transition-transform ${categoryDropdownOpen ? "rotate-180" : ""}`} />
          </button>
          {categoryDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-lg border z-30 max-h-64 overflow-y-auto">
              <Link
                href="/blog"
                className="block w-full text-left px-4 py-3 transition hover:bg-gray-50"
                onClick={() => setCategoryDropdownOpen(false)}
              >
                All Posts
              </Link>
              {categories.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/blog/category/${cat.slug}`}
                  className={`block w-full text-left px-4 py-3 transition ${
                    cat.slug === category.slug ? "bg-green-50 text-green-700 font-medium" : "hover:bg-gray-50"
                  }`}
                  onClick={() => setCategoryDropdownOpen(false)}
                >
                  {cat.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Main Content */}
        <main className="flex-1">
          {/* View Toggle */}
          <div className="flex items-center justify-between mb-6">
            <p className="text-gray-600 text-sm">
              Showing {posts.length} {posts.length === 1 ? "post" : "posts"}
            </p>
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 rounded ${viewMode === "grid" ? "bg-white shadow" : "hover:bg-gray-200"}`}
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 rounded ${viewMode === "list" ? "bg-white shadow" : "hover:bg-gray-200"}`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>

          {posts.length === 0 ? (
            <div className="text-center py-16">
              <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                <Tag className="w-10 h-10 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No posts yet</h3>
              <p className="text-gray-600 mb-6">There are no posts in this category yet. Check back later!</p>
              <Link href="/blog">
                <Button className="bg-green-600 hover:bg-green-700">Browse All Posts</Button>
              </Link>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {posts.map((post) => (
                <article
                  key={post.id}
                  className="group bg-white rounded-xl border overflow-hidden hover:shadow-xl transition duration-300"
                >
                  <Link href={`/blog/${post.slug}`}>
                    <div className="aspect-video bg-gray-100 overflow-hidden relative">
                      <img
                        src={
                          post.hero_image_url || post.image_url || "/placeholder.svg?height=200&width=400&query=blog"
                        }
                        alt={post.title}
                        className="w-full h-full object-cover group-hover:scale-110 transition duration-500"
                      />
                      {post.average_rating && Number(post.average_rating) >= 3.5 && (
                        <div className="absolute top-3 right-3 bg-amber-400 text-white px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                          <Star className="w-3 h-3 fill-current" />
                          {Number(post.average_rating).toFixed(1)}
                        </div>
                      )}
                    </div>
                  </Link>
                  <div className="p-5">
                    <Link href={`/blog/${post.slug}`}>
                      <h3 className="font-bold text-gray-900 mb-2 group-hover:text-green-600 transition line-clamp-2 text-lg">
                        {post.title}
                      </h3>
                    </Link>
                    <p className="text-sm text-gray-600 line-clamp-2 mb-4">{post.excerpt}</p>
                    <div className="flex items-center justify-between text-xs text-gray-500 pt-4 border-t">
                      <span>{formatDate(post.published_at)}</span>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Eye className="w-3 h-3" />
                          {post.read_count || 0}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle className="w-3 h-3" />
                          {post.comment_count || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {posts.map((post) => (
                <article
                  key={post.id}
                  className="group bg-white rounded-xl border overflow-hidden hover:shadow-lg transition flex flex-col md:flex-row"
                >
                  <Link href={`/blog/${post.slug}`} className="md:w-2/5 flex-shrink-0">
                    <div className="aspect-video md:aspect-[4/3] bg-gray-100 overflow-hidden relative h-full">
                      <img
                        src={
                          post.hero_image_url || post.image_url || "/placeholder.svg?height=300&width=400&query=blog"
                        }
                        alt={post.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                      {post.average_rating && Number(post.average_rating) >= 3.5 && (
                        <div className="absolute top-3 left-3 bg-amber-400 text-white px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                          <Star className="w-3 h-3 fill-current" />
                          {Number(post.average_rating).toFixed(1)}
                        </div>
                      )}
                    </div>
                  </Link>
                  <div className="p-6 flex flex-col justify-center md:w-3/5">
                    <Link href={`/blog/${post.slug}`}>
                      <h3 className="font-bold text-gray-900 mb-3 group-hover:text-green-600 transition text-xl line-clamp-2">
                        {post.title}
                      </h3>
                    </Link>
                    <p className="text-gray-600 line-clamp-3 mb-4">{post.excerpt}</p>
                    <div className="flex items-center justify-between text-sm text-gray-500">
                      <div className="flex gap-4 flex-wrap">
                        <span>{formatDate(post.published_at)}</span>
                        {post.author_name && <span>By {post.author_name}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Eye className="w-4 h-4" />
                          {post.read_count || 0}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle className="w-4 h-4" />
                          {post.comment_count || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <GlobalFooter />
    </div>
  )
}
