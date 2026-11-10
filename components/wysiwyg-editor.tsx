"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  LinkIcon,
  ImageIcon,
  Heading2,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react"

interface WYSIWYGEditorProps {
  value: string
  onChange: (content: string) => void
  placeholder?: string
}

export function WYSIWYGEditor({ value, onChange, placeholder = "Start writing..." }: WYSIWYGEditorProps) {
  const [showPreview, setShowPreview] = useState(false)

  const applyCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value)
  }

  const handleContentChange = (e: React.FormEvent<HTMLDivElement>) => {
    const html = e.currentTarget.innerHTML
    onChange(html)
  }

  const insertLink = () => {
    const url = prompt("Enter URL:", "https://")
    if (url) {
      applyCommand("createLink", url)
    }
  }

  const insertImage = () => {
    const url = prompt("Enter image URL:", "https://")
    if (url) {
      applyCommand("insertImage", url)
    }
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 p-3 bg-gray-50 border-b border-gray-300">
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyCommand("bold")}
            title="Bold"
            className="h-8 w-8 p-0"
          >
            <Bold className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyCommand("italic")}
            title="Italic"
            className="h-8 w-8 p-0"
          >
            <Italic className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyCommand("underline")}
            title="Underline"
            className="h-8 w-8 p-0"
          >
            <Underline className="w-4 h-4" />
          </Button>
        </div>

        <div className="border-l border-gray-300 my-1" />

        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyCommand("formatBlock", "h2")}
            title="Heading"
            className="h-8 w-8 p-0"
          >
            <Heading2 className="w-4 h-4" />
          </Button>
        </div>

        <div className="border-l border-gray-300 my-1" />

        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyCommand("insertUnorderedList")}
            title="Bullet List"
            className="h-8 w-8 p-0"
          >
            <List className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyCommand("insertOrderedList")}
            title="Ordered List"
            className="h-8 w-8 p-0"
          >
            <ListOrdered className="w-4 h-4" />
          </Button>
        </div>

        <div className="border-l border-gray-300 my-1" />

        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyCommand("justifyLeft")}
            title="Align Left"
            className="h-8 w-8 p-0"
          >
            <AlignLeft className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyCommand("justifyCenter")}
            title="Align Center"
            className="h-8 w-8 p-0"
          >
            <AlignCenter className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyCommand("justifyRight")}
            title="Align Right"
            className="h-8 w-8 p-0"
          >
            <AlignRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="border-l border-gray-300 my-1" />

        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={insertLink}
            title="Insert Link"
            className="h-8 w-8 p-0"
          >
            <LinkIcon className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={insertImage}
            title="Insert Image"
            className="h-8 w-8 p-0"
          >
            <ImageIcon className="w-4 h-4" />
          </Button>
        </div>

        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            variant={showPreview ? "default" : "ghost"}
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            className="h-8"
          >
            {showPreview ? "Edit" : "Preview"}
          </Button>
        </div>
      </div>

      {/* Editor Content Area */}
      {!showPreview ? (
        <div
          contentEditable
          onInput={handleContentChange}
          className="w-full h-96 p-4 focus:outline-none prose prose-sm max-w-none"
          suppressContentEditableWarning
        >
          {value || `<p style="color: #999;">${placeholder}</p>`}
        </div>
      ) : (
        <div
          className="w-full h-96 p-4 overflow-auto prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: value || `<p style="color: #999;">${placeholder}</p>` }}
        />
      )}
    </div>
  )
}
