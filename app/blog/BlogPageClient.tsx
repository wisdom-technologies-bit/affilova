"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Loader2,
  Menu,
  X,
  ChevronDown,
  Eye,
  MessageCircle,
  Star,
  TrendingUp,
  Heart,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
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

export default function BlogPageClient() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [popularPosts, setPopularPosts] = useState<BlogPost[]>([])
  const [recommendedPosts, setRecommendedPosts] = useState<BlogPost[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false)
  const [popularSlideIndex, setPopularSlideIndex] = useState(0)
  const popularSliderRef = useRef<HTMLDivElement>(null)

  const fetchBlogData = useCallback(async () => {
    try {
      const response = await fetch("/api/blog", { cache: "no-store" })
      if (response.ok) {
        const data = await response.json()
        setPosts(data.posts)
        setCategories(data.categories)
        setPopularPosts(data.popularPosts || [])
        setRecommendedPosts(data.recommendedPosts || [])
      }
    } catch (error) {
      console.error("Error fetching blog data:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBlogData()
    const interval = setInterval(fetchBlogData, 30000)
    return () => clearInterval(interval)
  }, [fetchBlogData])

  const filteredPosts = selectedCategory ? posts.filter((post) => post.category_slug === selectedCategory) : posts

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

  const handlePopularSlide = (direction: "prev" | "next") => {
    if (popularPosts.length <= 2) return
    if (direction === "next") {
      setPopularSlideIndex((prev) => (prev + 2 >= popularPosts.length ? 0 : prev + 2))
    } else {
      setPopularSlideIndex((prev) => (prev - 2 < 0 ? Math.max(popularPosts.length - 2, 0) : prev - 2))
    }
  }

  const visiblePopularPosts = popularPosts.slice(popularSlideIndex, popularSlideIndex + 2)

  // First post for featured section, rest for grid
  const featuredPost = filteredPosts[0]
  const gridPosts = filteredPosts.slice(1)

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center space-x-2">
            <img src="/affilova-logo.png" alt="Affilova" className="h-10 w-auto" />
          </Link>
          <div className="hidden md:flex space-x-4">
            <Link href="/auth/login">
              <Button variant="ghost" className="text-gray-600">
                Sign In
              </Button>
            </Link>
          </div>
          {/* Mobile menu button */}
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
          <Link href="/auth/login" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
            Sign In
          </Link>
        </div>
      )}

      {/* Hero Section */}
      <section className="py-12 md:py-16 px-4 border-b bg-gradient-to-br from-green-50 via-white to-emerald-50">
        <div className="container mx-auto text-center max-w-2xl">
          <h1 className="text-3xl md:text-5xl font-bold text-gray-900 mb-4">The Affilova Blog</h1>
          <p className="text-lg md:text-xl text-gray-600">
            Tips for creators to make money online and Affilova updates.
          </p>
        </div>
      </section>

      {/* Popular Posts Slider - Only show if there are popular posts */}
      {popularPosts.length > 0 && (
        <section className="py-8 px-4 bg-gradient-to-r from-amber-50 to-orange-50 border-b">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-orange-500" />
                <h2 className="text-xl font-bold text-gray-900">Trending Posts</h2>
              </div>
              {popularPosts.length > 2 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePopularSlide("prev")}
                    className="p-2 rounded-full bg-white shadow hover:bg-gray-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handlePopularSlide("next")}
                    className="p-2 rounded-full bg-white shadow hover:bg-gray-50 transition"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            <div className="grid md:grid-cols-2 gap-6" ref={popularSliderRef}>
              {visiblePopularPosts.map((post) => (
                <Link key={post.id} href={`/blog/${post.slug}`} className="group">
                  <div className="bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl transition flex flex-col md:flex-row">
                    <div className="md:w-2/5 aspect-video md:aspect-square bg-gray-100 overflow-hidden">
                      <img
                        src={
                          post.hero_image_url || post.image_url || "/placeholder.svg?height=200&width=300&query=blog"
                        }
                        alt={post.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                    </div>
                    <div className="p-4 md:w-3/5 flex flex-col justify-center">
                      {post.category_name && (
                        <span className="text-xs font-semibold text-orange-600 uppercase mb-2">
                          #{post.category_name}
                        </span>
                      )}
                      <h3 className="font-bold text-gray-900 group-hover:text-green-600 transition line-clamp-2 mb-2">
                        {post.title}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
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
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="container mx-auto px-4 py-8 md:py-12 flex flex-col lg:flex-row gap-8 lg:gap-12 flex-1">
        {/* Sidebar - Desktop */}
        <aside className="hidden lg:block w-48 flex-shrink-0">
          <div className="sticky top-24">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 uppercase">Categories</h3>
            <div className="space-y-2">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`w-full text-left px-3 py-2 rounded-lg transition text-sm ${
                  selectedCategory === null
                    ? "bg-green-100 text-green-700 font-medium"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                All Posts
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.slug)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition text-sm ${
                    selectedCategory === category.slug
                      ? "bg-green-100 text-green-700 font-medium"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {category.name}
                </button>
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
            <span className="font-medium text-gray-900">
              {selectedCategory
                ? categories.find((c) => c.slug === selectedCategory)?.name || "All Posts"
                : "All Categories"}
            </span>
            <ChevronDown className={`w-5 h-5 transition-transform ${categoryDropdownOpen ? "rotate-180" : ""}`} />
          </button>
          {categoryDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-lg border z-30 max-h-64 overflow-y-auto">
              <button
                onClick={() => {
                  setSelectedCategory(null)
                  setCategoryDropdownOpen(false)
                }}
                className={`w-full text-left px-4 py-3 transition ${
                  selectedCategory === null ? "bg-green-50 text-green-700 font-medium" : "hover:bg-gray-50"
                }`}
              >
                All Posts
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => {
                    setSelectedCategory(category.slug)
                    setCategoryDropdownOpen(false)
                  }}
                  className={`w-full text-left px-4 py-3 transition ${
                    selectedCategory === category.slug ? "bg-green-50 text-green-700 font-medium" : "hover:bg-gray-50"
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-green-600" />
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-600">No blog posts found.</p>
            </div>
          ) : (
            <div className="space-y-12">
              {/* Featured Post */}
              {featuredPost && (
                <article className="group">
                  <Link href={`/blog/${featuredPost.slug}`}>
                    {(featuredPost.hero_image_url || featuredPost.image_url) && (
                      <div className="aspect-video rounded-xl overflow-hidden bg-gray-100 mb-6">
                        <img
                          src={featuredPost.hero_image_url || featuredPost.image_url || "/placeholder.svg"}
                          alt={featuredPost.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                      </div>
                    )}
                  </Link>
                  {featuredPost.category_name && (
                    <Link href={`/blog/category/${featuredPost.category_slug}`} className="inline-block mb-3">
                      <span className="text-xs font-semibold text-green-600 uppercase hover:text-green-700">
                        #{featuredPost.category_name}
                      </span>
                    </Link>
                  )}
                  <Link href={`/blog/${featuredPost.slug}`}>
                    <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3 group-hover:text-green-600 transition">
                      {featuredPost.title}
                    </h2>
                  </Link>
                  <p className="text-gray-600 mb-4 line-clamp-3">{featuredPost.excerpt}</p>
                  <div className="flex items-center justify-between text-sm text-gray-500 flex-wrap gap-2">
                    <div className="flex gap-4 flex-wrap">
                      <span>Published {formatDate(featuredPost.published_at)}</span>
                      {featuredPost.author_name && <span>By {featuredPost.author_name}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <Eye className="w-4 h-4" />
                        {featuredPost.read_count || 0}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-4 h-4" />
                        {featuredPost.comment_count || 0}
                      </span>
                    </div>
                  </div>
                </article>
              )}

              {/* Grid Posts */}
              {gridPosts.length > 0 && (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {gridPosts.map((post) => (
                    <article
                      key={post.id}
                      className="group bg-white rounded-xl border overflow-hidden hover:shadow-lg transition"
                    >
                      <Link href={`/blog/${post.slug}`}>
                        <div className="aspect-video bg-gray-100 overflow-hidden">
                          <img
                            src={
                              post.hero_image_url ||
                              post.image_url ||
                              "/placeholder.svg?height=200&width=400&query=blog" ||
                              "/placeholder.svg"
                            }
                            alt={post.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          />
                        </div>
                      </Link>
                      <div className="p-4">
                        {post.category_name && (
                          <Link href={`/blog/category/${post.category_slug}`} className="inline-block mb-2">
                            <span className="text-xs font-semibold text-green-600 uppercase hover:text-green-700">
                              #{post.category_name}
                            </span>
                          </Link>
                        )}
                        <Link href={`/blog/${post.slug}`}>
                          <h3 className="font-bold text-gray-900 mb-2 group-hover:text-green-600 transition line-clamp-2">
                            {post.title}
                          </h3>
                        </Link>
                        <p className="text-sm text-gray-600 line-clamp-2 mb-3">{post.excerpt}</p>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>{formatDate(post.published_at)}</span>
                          <div className="flex items-center gap-2">
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
              )}
            </div>
          )}

          {/* Recommended Posts Section */}
          {recommendedPosts.length > 0 && (
            <section className="mt-16 pt-12 border-t">
              <div className="flex items-center gap-2 mb-8">
                <Heart className="w-5 h-5 text-red-500" />
                <h2 className="text-2xl font-bold text-gray-900">Recommended for You</h2>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {recommendedPosts.map((post) => (
                  <Link key={post.id} href={`/blog/${post.slug}`} className="group">
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl overflow-hidden hover:shadow-lg transition">
                      <div className="aspect-video bg-gray-100 overflow-hidden">
                        <img
                          src={
                            post.hero_image_url ||
                            post.image_url ||
                            "/placeholder.svg?height=200&width=400&query=recommended" ||
                            "/placeholder.svg"
                          }
                          alt={post.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                      </div>
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          {post.average_rating && (
                            <span className="flex items-center gap-1 text-amber-500 text-sm">
                              <Star className="w-4 h-4 fill-current" />
                              {Number(post.average_rating).toFixed(1)}
                            </span>
                          )}
                          {post.category_name && (
                            <span className="text-xs font-semibold text-green-600 uppercase">
                              #{post.category_name}
                            </span>
                          )}
                        </div>
                        <h3 className="font-bold text-gray-900 group-hover:text-green-600 transition line-clamp-2">
                          {post.title}
                        </h3>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>

      {/* Footer */}
      <GlobalFooter />
    </div>
  )
}
