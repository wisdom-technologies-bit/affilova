import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Tailwind's class merger has to be told about the design system's type scale.
//
// Without this, `cn("text-small text-foreground")` drops text-small: the merger
// only knows Tailwind's own size names (text-sm, text-lg ...) and treats
// anything else starting with `text-` as a colour, so the two collide and the
// later one wins. The size would silently disappear from every component that
// passes both through cn(). Registering the scale keeps them in separate groups.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["display", "display-sm", "h1", "h2", "h3", "body", "dense", "small", "caption"],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Generate 6-character alphanumeric ID
export function generateAlphanumericId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Generate 8-character alphanumeric ID for products, transactions, etc.
export function generateLongAlphanumericId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Generate tracking code for affiliate links
export function generateTrackingCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export const generateId = generateAlphanumericId
