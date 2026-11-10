"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DashboardLayout } from "@/components/dashboard-layout"
import { AlertCircle, Loader2, Plus, Edit2, Trash2, Code, Eye } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface BlogPost {
  id: string
  title: string
  slug: string
  content: string
  excerpt: string
  status: "draft" | "published" | "archived"
  category_id: string
  category_name?: string
  image_url?: string
  hero_image_url?: string
  published_at: string | null
  created_at: string
}

interface Category {
  id: string
  name: string
  slug: string
  description?: string
}

export default function AdminBlogPage() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showPostForm, setShowPostForm] = useState(false)
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [editorMode, setEditorMode] = useState<"html" | "wysiwyg">("wysiwyg")
  const { toast } = useToast()

  const [postFormData, setPostFormData] = useState({
    title: "",
    slug: "",
    content: "",
    excerpt: "",
    status: "draft" as "draft" | "published" | "archived",
    category_id: "",
    image_url: "",
    hero_image_url: "",
  })

  const [categoryFormData, setCategoryFormData] = useState({
    name: "",
    slug: "",
    description: "",
  })

  useEffect(() => {
    fetchBlogData()
  }, [])

  const fetchBlogData = async () => {
    try {
      const response = await fetch("/api/admin/blog")
      if (response.ok) {
        const data = await response.json()
        setPosts(data.posts)
        setCategories(data.categories)
      }
    } catch (err) {
      setError("Failed to load blog data")
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim()
  }

  const handlePostTitleChange = (title: string) => {
    setPostFormData((prev) => ({ ...prev, title }))
    if (!editingPost) {
      setPostFormData((prev) => ({ ...prev, slug: generateSlug(title) }))
    }
  }

  const handlePostSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!postFormData.title || !postFormData.slug || !postFormData.content) {
      setError("Title, slug, and content are required")
      return
    }

    setSaving(true)
    try {
      const url = editingPost ? `/api/admin/blog/${editingPost.id}` : "/api/admin/blog"
      const method = editingPost ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postFormData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to save blog post")
      }

      toast({
        title: "Success",
        description: editingPost ? "Blog post updated" : "Blog post created",
      })

      setPostFormData({
        title: "",
        slug: "",
        content: "",
        excerpt: "",
        status: "draft",
        category_id: "",
        image_url: "",
        hero_image_url: "",
      })
      setEditingPost(null)
      setShowPostForm(false)
      fetchBlogData()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save blog post"
      setError(errorMessage)
    } finally {
      setSaving(false)
    }
  }

  const handleCategoryTitleChange = (name: string) => {
    setCategoryFormData((prev) => ({ ...prev, name }))
    if (!editingCategory) {
      setCategoryFormData((prev) => ({ ...prev, slug: generateSlug(name) }))
    }
  }

  const handleCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!categoryFormData.name || !categoryFormData.slug) {
      setError("Category name and slug are required")
      return
    }

    setSaving(true)
    try {
      const url = editingCategory ? `/api/admin/blog/categories/${editingCategory.id}` : "/api/admin/blog/categories"
      const method = editingCategory ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(categoryFormData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to save category")
      }

      toast({
        title: "Success",
        description: editingCategory ? "Category updated" : "Category created",
      })

      setCategoryFormData({ name: "", slug: "", description: "" })
      setEditingCategory(null)
      setShowCategoryForm(false)
      fetchBlogData()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save category"
      setError(errorMessage)
    } finally {
      setSaving(false)
    }
  }

  const handleEditPost = (post: BlogPost) => {
    setPostFormData({
      title: post.title,
      slug: post.slug,
      content: post.content,
      excerpt: post.excerpt,
      status: post.status,
      category_id: post.category_id || "",
      image_url: post.image_url || "",
      hero_image_url: post.hero_image_url || "",
    })
    setEditingPost(post)
    setShowPostForm(true)
  }

  const handleEditCategory = (category: Category) => {
    setCategoryFormData({
      name: category.name,
      slug: category.slug,
      description: category.description || "",
    })
    setEditingCategory(category)
    setShowCategoryForm(true)
  }

  const handleDeletePost = async (id: string) => {
    if (!confirm("Are you sure you want to delete this post?")) return

    try {
      const response = await fetch(`/api/admin/blog/${id}`, { method: "DELETE" })
      if (response.ok) {
        toast({ title: "Blog post deleted" })
        fetchBlogData()
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to delete post", variant: "destructive" })
    }
  }

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Are you sure? Posts in this category will not be deleted.")) return

    try {
      const response = await fetch(`/api/admin/blog/categories/${id}`, { method: "DELETE" })
      if (response.ok) {
        toast({ title: "Category deleted" })
        fetchBlogData()
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to delete category", variant: "destructive" })
    }
  }

  if (loading) {
    return (
      <DashboardLayout role="admin">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Blog Management</h1>
            <p className="text-gray-600 mt-1">Create and manage blog posts and categories</p>
          </div>
        </div>

        <Tabs defaultValue="posts" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="posts">Blog Posts</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
          </TabsList>

          {/* Posts Tab */}
          <TabsContent value="posts" className="space-y-6">
            <div className="flex justify-between items-center">
              <div></div>
              <Button
                onClick={() => {
                  setPostFormData({
                    title: "",
                    slug: "",
                    content: "",
                    excerpt: "",
                    status: "draft",
                    category_id: "",
                    image_url: "",
                    hero_image_url: "",
                  })
                  setEditingPost(null)
                  setShowPostForm(!showPostForm)
                  setEditorMode("wysiwyg")
                }}
                className="bg-green-600 hover:bg-green-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                {showPostForm ? "Cancel" : "New Post"}
              </Button>
            </div>

            {showPostForm && (
              <Card>
                <CardHeader>
                  <CardTitle>{editingPost ? "Edit Post" : "Create New Post"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handlePostSubmit} className="space-y-6">
                    {error && (
                      <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-md">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm">{error}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="title">Title *</Label>
                        <Input
                          id="title"
                          value={postFormData.title}
                          onChange={(e) => handlePostTitleChange(e.target.value)}
                          placeholder="Enter blog post title"
                        />
                      </div>

                      <div>
                        <Label htmlFor="category">Category</Label>
                        <Select
                          value={postFormData.category_id}
                          onValueChange={(value) => setPostFormData((prev) => ({ ...prev, category_id: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((cat) => (
                              <SelectItem key={cat.id} value={cat.id}>
                                {cat.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="slug">Slug *</Label>
                      <Input
                        id="slug"
                        value={postFormData.slug}
                        onChange={(e) => setPostFormData((prev) => ({ ...prev, slug: e.target.value }))}
                        placeholder="blog-post-slug"
                        className="font-mono"
                      />
                    </div>

                    <div>
                      <Label htmlFor="excerpt">Excerpt</Label>
                      <Textarea
                        id="excerpt"
                        value={postFormData.excerpt}
                        onChange={(e) => setPostFormData((prev) => ({ ...prev, excerpt: e.target.value }))}
                        placeholder="Brief summary of the post"
                        rows={2}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="image-url">Featured Image URL</Label>
                        <Input
                          id="image-url"
                          value={postFormData.image_url}
                          onChange={(e) => setPostFormData((prev) => ({ ...prev, image_url: e.target.value }))}
                          placeholder="https://example.com/image.jpg"
                        />
                      </div>

                      <div>
                        <Label htmlFor="hero-image-url">Hero Image URL</Label>
                        <Input
                          id="hero-image-url"
                          value={postFormData.hero_image_url}
                          onChange={(e) => setPostFormData((prev) => ({ ...prev, hero_image_url: e.target.value }))}
                          placeholder="https://example.com/hero.jpg"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 border-b pb-4">
                      <Button
                        type="button"
                        variant={editorMode === "wysiwyg" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setEditorMode("wysiwyg")}
                        className="flex gap-2"
                      >
                        <Eye className="w-4 h-4" />
                        WYSIWYG
                      </Button>
                      <Button
                        type="button"
                        variant={editorMode === "html" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setEditorMode("html")}
                        className="flex gap-2"
                      >
                        <Code className="w-4 h-4" />
                        HTML
                      </Button>
                    </div>

                    <div>
                      <Label htmlFor="content">Content {editorMode === "html" ? "(HTML)" : "(WYSIWYG)"} *</Label>
                      {editorMode === "html" ? (
                        <Textarea
                          id="content"
                          value={postFormData.content}
                          onChange={(e) => setPostFormData((prev) => ({ ...prev, content: e.target.value }))}
                          placeholder={`Paste your HTML code here or type HTML content:
<h1>Title</h1>
<p>Your content here...</p>
<img src="url" alt="description">`}
                          rows={12}
                          className="font-mono text-sm"
                        />
                      ) : (
                        <Textarea
                          id="content"
                          value={postFormData.content}
                          onChange={(e) => setPostFormData((prev) => ({ ...prev, content: e.target.value }))}
                          placeholder={`Write your blog content in plain text:
- Use line breaks for paragraphs
- Add emphasis with *asterisks*
- Create lists naturally

Content will be converted to HTML.`}
                          rows={12}
                        />
                      )}
                      <p className="text-xs text-gray-500 mt-2">
                        {editorMode === "html"
                          ? "Paste complete HTML code or write HTML tags directly"
                          : "Write in plain text - formatting will be applied when published"}
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="status">Status</Label>
                      <Select
                        value={postFormData.status}
                        onValueChange={(value) => setPostFormData((prev) => ({ ...prev, status: value as any }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="published">Published</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex gap-2">
                      <Button type="submit" className="bg-green-600 hover:bg-green-700" disabled={saving}>
                        {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {editingPost ? "Update Post" : "Create Post"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            <div className="space-y-4">
              {posts.length === 0 ? (
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-center text-gray-600">No blog posts yet. Create your first post!</p>
                  </CardContent>
                </Card>
              ) : (
                posts.map((post) => (
                  <Card key={post.id}>
                    <CardHeader className="flex flex-row items-start justify-between">
                      <div className="flex-1">
                        <CardTitle>{post.title}</CardTitle>
                        <CardDescription className="text-xs mt-2">
                          {post.category_name && <span className="font-medium">{post.category_name} • </span>}
                          {post.status === "published" && post.published_at && (
                            <span>Published: {new Date(post.published_at).toLocaleDateString()}</span>
                          )}
                          {post.status === "draft" && <span>Draft</span>}
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditPost(post)}
                          className="bg-transparent"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDeletePost(post.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-gray-600 line-clamp-2">{post.excerpt || post.content}</p>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Categories Tab */}
          <TabsContent value="categories" className="space-y-6">
            <div className="flex justify-between items-center">
              <div></div>
              <Button
                onClick={() => {
                  setCategoryFormData({ name: "", slug: "", description: "" })
                  setEditingCategory(null)
                  setShowCategoryForm(!showCategoryForm)
                }}
                className="bg-green-600 hover:bg-green-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                {showCategoryForm ? "Cancel" : "New Category"}
              </Button>
            </div>

            {showCategoryForm && (
              <Card>
                <CardHeader>
                  <CardTitle>{editingCategory ? "Edit Category" : "Create New Category"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCategorySubmit} className="space-y-6">
                    {error && (
                      <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-md">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm">{error}</span>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="cat-name">Category Name *</Label>
                      <Input
                        id="cat-name"
                        value={categoryFormData.name}
                        onChange={(e) => handleCategoryTitleChange(e.target.value)}
                        placeholder="Enter category name"
                      />
                    </div>

                    <div>
                      <Label htmlFor="cat-slug">Slug *</Label>
                      <Input
                        id="cat-slug"
                        value={categoryFormData.slug}
                        onChange={(e) => setCategoryFormData((prev) => ({ ...prev, slug: e.target.value }))}
                        placeholder="category-slug"
                        className="font-mono"
                      />
                    </div>

                    <div>
                      <Label htmlFor="cat-desc">Description</Label>
                      <Textarea
                        id="cat-desc"
                        value={categoryFormData.description}
                        onChange={(e) => setCategoryFormData((prev) => ({ ...prev, description: e.target.value }))}
                        placeholder="Category description"
                        rows={3}
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button type="submit" className="bg-green-600 hover:bg-green-700" disabled={saving}>
                        {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {editingCategory ? "Update Category" : "Create Category"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {categories.length === 0 ? (
                <Card className="md:col-span-2">
                  <CardContent className="pt-6">
                    <p className="text-center text-gray-600">No categories yet. Create your first category!</p>
                  </CardContent>
                </Card>
              ) : (
                categories.map((category) => (
                  <Card key={category.id}>
                    <CardHeader className="flex flex-row items-start justify-between">
                      <div className="flex-1">
                        <CardTitle>{category.name}</CardTitle>
                        <CardDescription className="text-xs mt-1 font-mono">{category.slug}</CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditCategory(category)}
                          className="bg-transparent"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDeleteCategory(category.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    {category.description && (
                      <CardContent>
                        <p className="text-sm text-gray-600">{category.description}</p>
                      </CardContent>
                    )}
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}
