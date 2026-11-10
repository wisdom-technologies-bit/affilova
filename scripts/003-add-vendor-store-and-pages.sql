-- Add vendor store settings table
CREATE TABLE IF NOT EXISTS vendor_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL UNIQUE REFERENCES vendors(id) ON DELETE CASCADE,
  store_slug VARCHAR(50) NOT NULL UNIQUE,
  store_name VARCHAR(255) NOT NULL,
  store_url VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add sales pages table
CREATE TABLE IF NOT EXISTS sales_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  content TEXT,
  slug VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add thank you pages table
CREATE TABLE IF NOT EXISTS thank_you_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL DEFAULT 'template', -- 'template' or 'custom_url'
  custom_url VARCHAR(500),
  product_file_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Remove sales_page_url and thank_you_page_url from products table (if they exist)
ALTER TABLE products DROP COLUMN IF EXISTS sales_page_url;
ALTER TABLE products DROP COLUMN IF EXISTS thank_you_page_url;

-- Add indexes for better query performance
CREATE INDEX idx_vendor_stores_vendor_id ON vendor_stores(vendor_id);
CREATE INDEX idx_vendor_stores_slug ON vendor_stores(store_slug);
CREATE INDEX idx_sales_pages_product_id ON sales_pages(product_id);
CREATE INDEX idx_sales_pages_slug ON sales_pages(slug);
CREATE INDEX idx_thank_you_pages_product_id ON thank_you_pages(product_id);
