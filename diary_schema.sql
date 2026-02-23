-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table (Public profile table mirroring auth.users)
-- This table is usually populated via triggers on auth.users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    name TEXT,
    email TEXT,
    role TEXT DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- Diary Entries Table
CREATE TABLE IF NOT EXISTS diary_entries (
    id TEXT PRIMARY KEY,
    date DATE,
    project TEXT,
    project_id TEXT, -- Assuming project ID is text
    author TEXT,
    weather TEXT,
    temperature TEXT,
    work_completed TEXT,
    incidents_reported TEXT,
    materials_delivered TEXT,
    notes TEXT,
    form_data JSONB,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT -- Can be node ID (text)
);

-- Diary Workflow Nodes Table
CREATE TABLE IF NOT EXISTS diary_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    diary_id TEXT REFERENCES diary_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES auth.users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'waiting', -- pending, waiting, completed, rejected, sent_back
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',
    expire_time TIMESTAMPTZ,
    expire_duration TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_by UUID REFERENCES auth.users(id),
    completed_at TIMESTAMPTZ,
    completion_count INTEGER DEFAULT 0,
    last_completed_at TIMESTAMPTZ,
    can_re_edit BOOLEAN DEFAULT TRUE,
    max_completions INTEGER DEFAULT 2
);

-- Diary Assignments Table (CC recipients)
CREATE TABLE IF NOT EXISTS diary_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    diary_id TEXT REFERENCES diary_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT DEFAULT 'cc',
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Diary Comments Table
CREATE TABLE IF NOT EXISTS diary_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    diary_id TEXT REFERENCES diary_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    comment TEXT,
    action TEXT, -- approve, reject, back, etc.
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Diary Workflow History Table
CREATE TABLE IF NOT EXISTS diary_workflow_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    diary_id TEXT REFERENCES diary_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_order INTEGER,
    action TEXT,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id),
    title TEXT,
    message TEXT,
    type TEXT, -- info, error, warning
    form_type TEXT, -- diary, safety, etc.
    form_id TEXT,
    project_id TEXT,
    action_url TEXT,
    metadata JSONB DEFAULT '{}',
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_diary_entries_project_id ON diary_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_diary_entries_created_by ON diary_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_diary_workflow_nodes_diary_id ON diary_workflow_nodes(diary_id);
CREATE INDEX IF NOT EXISTS idx_diary_workflow_nodes_executor_id ON diary_workflow_nodes(executor_id);
CREATE INDEX IF NOT EXISTS idx_diary_assignments_diary_id ON diary_assignments(diary_id);
CREATE INDEX IF NOT EXISTS idx_diary_assignments_user_id ON diary_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
