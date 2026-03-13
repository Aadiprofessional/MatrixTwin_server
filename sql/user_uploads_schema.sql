-- Create user_uploads table
CREATE TABLE IF NOT EXISTS user_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    file_type TEXT NOT NULL CHECK (file_type IN ('signature', 'attachment', 'image', 'pic')),
    file_url TEXT NOT NULL,
    original_name TEXT,
    mime_type TEXT,
    size INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster retrieval by user and type
CREATE INDEX IF NOT EXISTS idx_user_uploads_user_id ON user_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_user_uploads_file_type ON user_uploads(file_type);

-- Enable Row Level Security (RLS)
ALTER TABLE user_uploads ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to view their own uploads
CREATE POLICY "Users can view their own uploads" 
ON user_uploads FOR SELECT 
USING (auth.uid() = user_id);

-- Create policy to allow users to insert their own uploads
CREATE POLICY "Users can insert their own uploads" 
ON user_uploads FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Create policy to allow users to delete their own uploads
CREATE POLICY "Users can delete their own uploads" 
ON user_uploads FOR DELETE 
USING (auth.uid() = user_id);
