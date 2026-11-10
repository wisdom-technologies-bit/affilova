-- Add hero_image_url column to blog_posts table
ALTER TABLE blog_posts ADD COLUMN hero_image_url VARCHAR;

-- Create index for faster queries
CREATE INDEX idx_blog_posts_featured ON blog_posts(featured) WHERE featured = true;
