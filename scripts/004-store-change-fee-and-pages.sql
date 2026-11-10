-- Add new columns to vendor_stores for change tracking
ALTER TABLE vendor_stores ADD COLUMN IF NOT EXISTS store_name_changes INT DEFAULT 0;
ALTER TABLE vendor_stores ADD COLUMN IF NOT EXISTS store_slug_changes INT DEFAULT 0;
ALTER TABLE vendor_stores ADD COLUMN IF NOT EXISTS last_name_change_at TIMESTAMP DEFAULT NULL;
ALTER TABLE vendor_stores ADD COLUMN IF NOT EXISTS last_slug_change_at TIMESTAMP DEFAULT NULL;
ALTER TABLE vendor_stores ADD COLUMN IF NOT EXISTS can_change_for_free BOOLEAN DEFAULT true;

-- Create store change history table
CREATE TABLE IF NOT EXISTS store_change_history (
  id BIGSERIAL PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  change_type VARCHAR(50) NOT NULL, -- 'store_name' or 'store_slug'
  old_value VARCHAR(255),
  new_value VARCHAR(255),
  payment_status VARCHAR(50), -- 'pending', 'paid', 'free'
  payment_reference VARCHAR(255) DEFAULT NULL,
  change_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT change_type_check CHECK (change_type IN ('store_name', 'store_slug'))
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_store_change_history_vendor_id ON store_change_history(vendor_id);
CREATE INDEX IF NOT EXISTS idx_store_change_history_payment_status ON store_change_history(payment_status);

-- Add slug availability cache table
CREATE TABLE IF NOT EXISTS slug_availability_cache (
  id BIGSERIAL PRIMARY KEY,
  slug VARCHAR(255) UNIQUE NOT NULL,
  is_available BOOLEAN NOT NULL,
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '7 days'
);

-- Update products table to reflect new page structure
ALTER TABLE products ADD COLUMN IF NOT EXISTS sales_page_html TEXT DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS thank_you_page_type VARCHAR(50) DEFAULT 'template'; -- 'template' or 'custom_url'
ALTER TABLE products ADD COLUMN IF NOT EXISTS thank_you_page_custom_url VARCHAR(500) DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS thank_you_page_product_file_path VARCHAR(500) DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sales_page_slug VARCHAR(255) UNIQUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS thank_you_page_slug VARCHAR(255) UNIQUE;

-- Create indexes for sales page slugs
CREATE INDEX IF NOT EXISTS idx_products_sales_page_slug ON products(sales_page_slug);
CREATE INDEX IF NOT EXISTS idx_products_thank_you_page_slug ON products(thank_you_page_slug);

-- Create blog posts table for admin
CREATE TABLE IF NOT EXISTS blog_posts (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500) UNIQUE NOT NULL,
  content TEXT NOT NULL,
  excerpt VARCHAR(500),
  featured_image_url VARCHAR(500),
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'published', 'archived'
  published_at TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT status_check CHECK (status IN ('draft', 'published', 'archived'))
);

-- Create indexes for blog
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_author_id ON blog_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON blog_posts(published_at DESC);
