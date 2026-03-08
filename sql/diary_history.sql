-- Create table for tracking diary entry history
CREATE TABLE IF NOT EXISTS diary_entry_history (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    diary_id TEXT REFERENCES diary_entries(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    form_data JSONB,
    change_reason TEXT -- Optional: to store why it was changed (e.g., "update", "correction")
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_diary_history_diary_id ON diary_entry_history(diary_id);
CREATE INDEX IF NOT EXISTS idx_diary_history_changed_at ON diary_entry_history(changed_at DESC);
