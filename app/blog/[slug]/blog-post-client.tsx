"use client"

import Link from "next/link"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  ArrowLeft,
  Clock,
  User,
  Tag,
  Eye,
  MessageCircle,
  Star,
  TrendingUp,
  Share2,
  Bookmark,
  ChevronRight,
  Menu,
  X,
  Send,
  Loader2,
} from "lucide-react"
import GlobalFooter from "@/components/global-footer"
import { Logo } from "@/components/brand/logo"

interface Comment {
  id: string
  content: string
  created_at: string
  user_id: string
  first_name?: string
  last_name?: string
  profile_picture_url?: string
}

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

interface BlogPostClientProps {
  post: BlogPost
  popularPosts: BlogPost[]
}

export default function BlogPostClient({ post: initialPost, popularPosts }: BlogPostClientProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [post, setPost] = useState(initialPost)
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState("")
  const [userRating, setUserRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [isSubmittingComment, setIsSubmittingComment] = useState(false)
  const [isSubmittingRating, setIsSubmittingRating] = useState(false)
  const [commentError, setCommentError] = useState("")
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [anonName, setAnonName] = useState("")
  const [anonEmail, setAnonEmail] = useState("")

  // Fetch comments on mount
  useEffect(() => {
    fetchComments()
  }, [post.id])

  const fetchComments = async () => {
    try {
      const response = await fetch(`/api/blog/comments?postId=${post.id}`)
      if (response.ok) {
        const data = await response.json()
        setComments(data.comments || [])
      }
    } catch (error) {
      console.error("Error fetching comments:", error)
    }
  }

  const handleSubmitComment = async () => {
    if (!newComment.trim()) return

    // Check if user needs to provide name and email
    if (!anonName.trim() && !anonEmail.trim()) {
      setCommentError("Please enter your name and email to comment")
      return
    }

    if (!anonName.trim()) {
      setCommentError("Please enter your name")
      return
    }

    if (!anonEmail.trim()) {
      setCommentError("Please enter your email")
      return
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(anonEmail)) {
      setCommentError("Please enter a valid email address")
      return
    }

    setIsSubmittingComment(true)
    setCommentError("")

    try {
      const response = await fetch("/api/blog/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: post.id,
          content: newComment,
          authorName: anonName,
          authorEmail: anonEmail,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setComments((prev) => [data.comment, ...prev])
        setNewComment("")
        setAnonName("")
        setAnonEmail("")
        setShowCommentForm(false)
        // Update comment count immediately
        setPost((prev) => ({ ...prev, comment_count: (prev.comment_count || 0) + 1 }))
        // Show success message if comment is pending moderation
        if (data.message && !data.message.includes("successfully")) {
          setCommentError(`✓ ${data.message}`)
        }
      } else {
        setCommentError(data.error || "Failed to post comment")
      }
    } catch (error) {
      setCommentError("Failed to post comment. Please try again.")
    } finally {
      setIsSubmittingComment(false)
    }
  }

  const handleRating = async (rating: number) => {
    setIsSubmittingRating(true)

    try {
      const response = await fetch("/api/blog/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id, rating }),
      })

      const data = await response.json()

      if (response.ok) {
        setUserRating(rating)
        // Update rating immediately
        setPost((prev) => ({
          ...prev,
          average_rating: data.average_rating,
          rating_count: data.rating_count,
        }))
      }
    } catch (error) {
      console.error("Rating error:", error)
    } finally {
      setIsSubmittingRating(false)
    }
  }

  const publishedDate = new Date(post.published_at)
  const formattedDate = publishedDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  const readingTime = Math.ceil(post.content.split(/\s+/).length / 200)

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: post.title,
          text: post.excerpt,
          url: window.location.href,
        })
      } catch (err) {
        console.log("Share cancelled")
      }
    } else {
      navigator.clipboard.writeText(window.location.href)
      alert("Link copied to clipboard!")
    }
  }

  const formatCommentDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-2">
            <Logo variant="horizontal" className="h-10 w-auto" />
          </Link>
          <div className="hidden md:flex items-center gap-4">
            <Link href="/blog">
              <Button variant="ghost" className="text-gray-600 hover:text-gray-900">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Blog
              </Button>
            </Link>
            <button
              onClick={handleShare}
              className="p-2 rounded-full hover:bg-gray-100 transition"
              title="Share this post"
            >
              <Share2 className="w-5 h-5 text-gray-600" />
            </button>
          </div>
          <button className="md:hidden p-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </nav>

      {mobileMenuOpen && (
        <div className="md:hidden bg-white border-b px-4 py-4 space-y-2">
          <Link href="/" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
            Home
          </Link>
          <Link href="/blog" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
            All Posts
          </Link>
          <button
            onClick={handleShare}
            className="block w-full text-left px-4 py-2 text-gray-600 hover:bg-gray-50 rounded"
          >
            Share Post
          </button>
        </div>
      )}

      {/* Hero Section with Image */}
      {(post.hero_image_url || post.image_url) && (
        <div className="w-full bg-gradient-to-b from-gray-100 to-white">
          <div className="container mx-auto px-4">
            <div className="aspect-[21/9] md:aspect-[3/1] rounded-b-3xl overflow-hidden shadow-2xl">
              <img
                src={post.hero_image_url || post.image_url}
                alt={post.title}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <article className="container mx-auto px-4 py-8 md:py-12 max-w-4xl flex-1">
        {/* Category & Stats Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          {post.category_name && (
            <Link href={`/blog/category/${post.category_slug}`}>
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-full text-sm font-semibold hover:bg-green-200 transition">
                <Tag className="w-4 h-4" />
                {post.category_name}
              </span>
            </Link>
          )}
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Eye className="w-4 h-4" />
              {post.read_count || 0} reads
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle className="w-4 h-4" />
              {post.comment_count || 0} comments
            </span>
            {post.average_rating && Number(post.average_rating) > 0 && (
              <span className="flex items-center gap-1 text-amber-500">
                <Star className="w-4 h-4 fill-current" />
                {Number(post.average_rating).toFixed(1)}
              </span>
            )}
          </div>
        </div>

        {/* Title */}
        <h1 className="text-3xl md:text-5xl lg:text-6xl font-black text-gray-900 mb-6 leading-tight">{post.title}</h1>

        {/* Excerpt */}
        {post.excerpt && (
          <p className="text-xl md:text-2xl text-gray-600 mb-8 leading-relaxed font-light">{post.excerpt}</p>
        )}

        {/* Author & Meta Info */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-6 py-8 border-y border-gray-200 mb-10">
          {/* Author */}
          <div className="flex items-center gap-4">
            {post.author_avatar ? (
              <img
                src={post.author_avatar || "/placeholder.svg"}
                alt={post.author_name || "Author"}
                className="w-14 h-14 rounded-full object-cover ring-4 ring-green-100"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center ring-4 ring-green-100">
                <User className="w-7 h-7 text-white" />
              </div>
            )}
            <div>
              <p className="font-semibold text-gray-900 text-lg">{post.author_name || "Affilova Team"}</p>
              <p className="text-sm text-gray-500">Author</p>
            </div>
          </div>

          <div className="hidden sm:block w-px h-12 bg-gray-200" />

          {/* Date & Reading Time */}
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-sm text-gray-500">Published</p>
              <time dateTime={post.published_at} className="font-semibold text-gray-900">
                {formattedDate}
              </time>
            </div>
            <div>
              <p className="text-sm text-gray-500">Reading time</p>
              <p className="font-semibold text-gray-900 flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {readingTime} min read
              </p>
            </div>
          </div>
        </div>

        {/* Blog Content */}
        <div className="prose prose-lg md:prose-xl max-w-none mb-12">
          <div
            className="text-gray-700 leading-relaxed space-y-6 [&>h2]:text-2xl [&>h2]:font-bold [&>h2]:text-gray-900 [&>h2]:mt-10 [&>h2]:mb-4 [&>h3]:text-xl [&>h3]:font-semibold [&>h3]:text-gray-900 [&>h3]:mt-8 [&>h3]:mb-3 [&>p]:mb-4 [&>ul]:list-disc [&>ul]:pl-6 [&>ol]:list-decimal [&>ol]:pl-6 [&>blockquote]:border-l-4 [&>blockquote]:border-green-500 [&>blockquote]:pl-6 [&>blockquote]:italic [&>blockquote]:text-gray-600"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />
        </div>

        <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-6 md:p-8 mb-8">
          <div className="text-center">
            <h3 className="font-semibold text-gray-900 mb-2">Rate this article</h3>
            <p className="text-sm text-gray-600 mb-4">How helpful was this post?</p>
            <div className="flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => handleRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  disabled={isSubmittingRating}
                  className="p-1 transition-transform hover:scale-110 disabled:opacity-50"
                >
                  <Star
                    className={`w-8 h-8 transition-colors ${
                      star <= (hoverRating || userRating) ? "text-amber-400 fill-amber-400" : "text-gray-300"
                    }`}
                  />
                </button>
              ))}
            </div>
            {userRating > 0 && <p className="text-sm text-green-600 mt-2">Thanks for rating!</p>}
          </div>
        </div>

        {/* Share Section */}
        <div className="bg-gray-50 rounded-2xl p-6 md:p-8 mb-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Enjoyed this article?</h3>
              <p className="text-sm text-gray-600">Share it with your network</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleShare}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
              <button className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg hover:bg-gray-50 transition">
                <Bookmark className="w-4 h-4" />
                Save
              </button>
            </div>
          </div>
        </div>

        <div className="mb-12">
          <h3 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
            <MessageCircle className="w-6 h-6" />
            Comments ({comments.length})
          </h3>

          {/* Comment Form */}
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            {!showCommentForm ? (
              <Button
                onClick={() => setShowCommentForm(true)}
                className="w-full bg-green-600 hover:bg-green-700"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                Share your thoughts...
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={anonName}
                    onChange={(e) => setAnonName(e.target.value)}
                    placeholder="Your name"
                    className="p-3 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                  />
                  <input
                    type="email"
                    value={anonEmail}
                    onChange={(e) => setAnonEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="p-3 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                  />
                </div>
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Share your thoughts..."
                  className="w-full p-4 border rounded-lg resize-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                  rows={3}
                />
                {commentError && (
                  <p className={`text-sm mt-2 ${commentError.includes("✓") ? "text-green-600" : "text-red-500"}`}>
                    {commentError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => {
                      setShowCommentForm(false)
                      setNewComment("")
                      setAnonName("")
                      setAnonEmail("")
                      setCommentError("")
                    }}
                    variant="outline"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmitComment}
                    disabled={
                      isSubmittingComment ||
                      !newComment.trim() ||
                      !anonName.trim() ||
                      !anonEmail.trim()
                    }
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {isSubmittingComment ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    Post Comment
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Comments List */}
          <div className="space-y-4">
            {comments.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No comments yet. Be the first to share your thoughts!</p>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="bg-white border rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    {comment.profile_picture_url ? (
                      <img
                        src={comment.profile_picture_url || "/placeholder.svg"}
                        alt={comment.first_name || "User"}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
                        <User className="w-5 h-5 text-white" />
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">
                          {comment.first_name || "Anonymous"} {comment.last_name || ""}
                        </span>
                        <span className="text-xs text-gray-500">{formatCommentDate(comment.created_at)}</span>
                      </div>
                      <p className="text-gray-700">{comment.content}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* CTA Section */}
        <div className="bg-gradient-to-r from-green-600 to-emerald-600 rounded-3xl p-8 md:p-12 text-white mb-12 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full -ml-24 -mb-24" />
          <div className="relative z-10">
            <h3 className="text-2xl md:text-3xl font-bold mb-4">Ready to start earning?</h3>
            <p className="text-green-100 mb-6 max-w-lg">
              Join thousands of affiliates making money with Affilova. Sign up today and start promoting amazing
              products.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/auth/register">
                <Button size="lg" className="w-full sm:w-auto bg-white text-green-600 hover:bg-gray-100 font-semibold">
                  Get Started Free
                </Button>
              </Link>
              <Link href="/blog">
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full sm:w-auto border-2 border-white text-white hover:bg-white/10 bg-transparent"
                >
                  Read More Articles
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </article>

      {/* Popular Posts Section */}
      {popularPosts.length > 0 && (
        <section className="bg-gradient-to-b from-gray-50 to-white py-16">
          <div className="container mx-auto px-4 max-w-6xl">
            <div className="flex items-center gap-2 mb-8">
              <TrendingUp className="w-6 h-6 text-orange-500" />
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Popular Posts</h2>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {popularPosts.slice(0, 3).map((relatedPost) => (
                <Link key={relatedPost.id} href={`/blog/${relatedPost.slug}`} className="group">
                  <div className="bg-white border rounded-2xl overflow-hidden hover:shadow-xl transition duration-300">
                    <div className="aspect-video bg-gray-100 overflow-hidden">
                      <img
                        src={
                          relatedPost.hero_image_url ||
                          relatedPost.image_url ||
                          "/placeholder.svg?height=200&width=400&query=blog" ||
                          "/placeholder.svg" ||
                          "/placeholder.svg"
                         || "/placeholder.svg"}
                        alt={relatedPost.title}
                        className="w-full h-full object-cover group-hover:scale-110 transition duration-500"
                      />
                    </div>
                    <div className="p-5">
                      {relatedPost.category_name && (
                        <span className="text-xs font-semibold text-green-600 uppercase mb-2 block">
                          #{relatedPost.category_name}
                        </span>
                      )}
                      <h3 className="font-bold text-gray-900 group-hover:text-green-600 transition line-clamp-2 mb-3">
                        {relatedPost.title}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Eye className="w-3 h-3" />
                          {relatedPost.read_count || 0}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle className="w-3 h-3" />
                          {relatedPost.comment_count || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <div className="text-center mt-10">
              <Link href="/blog">
                <Button variant="outline" size="lg" className="bg-transparent">
                  View All Posts
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <GlobalFooter />
    </div>
  )
}
