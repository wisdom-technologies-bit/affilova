import { neon } from "@neondatabase/serverless"

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required")
}

export const sql = neon(process.env.DATABASE_URL)

// Generate 6-character alphanumeric ID
export function generateAlphanumericId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export interface User {
  id: string // UUID for backward compatibility
  alphanumeric_id: string // 6-character alphanumeric ID
  email: string
  role: "admin" | "vendor" | "affiliate"
  first_name: string
  last_name: string
  company_name?: string
  phone?: string
  is_verified: boolean
  is_active: boolean
  created_at: string
}

export interface Vendor {
  id: string
  user_id: string
  business_type?: string
  website_url?: string
  description?: string
  logo_url?: string
  is_approved: boolean
}

export interface Affiliate {
  id: string
  user_id: string
  experience_level?: string
  marketing_channels?: string[]
  website_url?: string
  social_media_links?: any
  is_approved: boolean
  registration_fee_paid: boolean
}

export interface Product {
  id: string
  vendor_id: string
  title: string
  description?: string
  price: number
  commission_rate: number
  category?: string
  image_url?: string
  sales_page_url?: string
  thank_you_page_url?: string
  is_active: boolean
  created_at: string
}
