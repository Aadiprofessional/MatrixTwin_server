-- Create inspection_entries table
CREATE TABLE IF NOT EXISTS inspection_entries (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    project TEXT NOT NULL,
    project_id TEXT,
    inspector TEXT NOT NULL,
    contract_no TEXT,
    risc_no TEXT,
    revision TEXT,
    supervisor TEXT,
    attention TEXT,
    location TEXT,
    works_to_be_inspected TEXT,
    works_category TEXT DEFAULT 'General',
    inspection_time TEXT,
    next_operation TEXT,
    general_cleaning TEXT,
    scheduled_time TEXT,
    scheduled_date DATE,
    equipment TEXT,
    no_objection BOOLEAN DEFAULT FALSE,
    deficiencies_noted BOOLEAN DEFAULT FALSE,
    deficiencies JSONB DEFAULT '[]'::jsonb,
    form_data JSONB NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected', 'permanently_rejected')),
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create inspection_workflow_nodes table
CREATE TABLE IF NOT EXISTS inspection_workflow_nodes (
    id SERIAL PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspection_entries(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    node_type TEXT NOT NULL,
    node_name TEXT NOT NULL,
    executor_id TEXT,
    executor_name TEXT,
    node_order INTEGER NOT NULL,
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'completed', 'rejected', 'sent_back')),
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}'::jsonb,
    expire_time TEXT,
    expire_duration TEXT,
    completed_by TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    completion_count INTEGER DEFAULT 0,
    last_completed_at TIMESTAMP WITH TIME ZONE,
    can_re_edit BOOLEAN DEFAULT TRUE,
    max_completions INTEGER DEFAULT 2,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create inspection_assignments table
CREATE TABLE IF NOT EXISTS inspection_assignments (
    id SERIAL PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspection_entries(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('executor', 'cc')),
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create inspection_comments table
CREATE TABLE IF NOT EXISTS inspection_comments (
    id SERIAL PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspection_entries(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    comment TEXT NOT NULL,
    action TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create inspection_workflow_history table
CREATE TABLE IF NOT EXISTS inspection_workflow_history (
    id SERIAL PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspection_entries(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    node_order INTEGER NOT NULL,
    action TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    comment TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_inspection_entries_created_by ON inspection_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_inspection_entries_project_id ON inspection_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_inspection_entries_status ON inspection_entries(status);
CREATE INDEX IF NOT EXISTS idx_inspection_entries_created_at ON inspection_entries(created_at);

CREATE INDEX IF NOT EXISTS idx_inspection_workflow_nodes_inspection_id ON inspection_workflow_nodes(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_workflow_nodes_executor_id ON inspection_workflow_nodes(executor_id);
CREATE INDEX IF NOT EXISTS idx_inspection_workflow_nodes_status ON inspection_workflow_nodes(status);

CREATE INDEX IF NOT EXISTS idx_inspection_assignments_inspection_id ON inspection_assignments(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_assignments_user_id ON inspection_assignments(user_id);

CREATE INDEX IF NOT EXISTS idx_inspection_comments_inspection_id ON inspection_comments(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_workflow_history_inspection_id ON inspection_workflow_history(inspection_id);

-- Enable RLS (Row Level Security)
ALTER TABLE inspection_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_workflow_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_workflow_history ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (basic policies - adjust based on your security requirements)
CREATE POLICY "Users can view their own inspection entries" ON inspection_entries
    FOR SELECT USING (auth.uid()::text = created_by);

CREATE POLICY "Users can view inspection entries they are assigned to" ON inspection_entries
    FOR SELECT USING (
        id IN (
            SELECT inspection_id FROM inspection_assignments WHERE user_id = auth.uid()::text
        )
    );

CREATE POLICY "Users can view inspection entries they are executors for" ON inspection_entries
    FOR SELECT USING (
        id IN (
            SELECT inspection_id FROM inspection_workflow_nodes WHERE executor_id = auth.uid()::text
        )
    );

-- Similar policies for other tables
CREATE POLICY "Users can view workflow nodes for their inspections" ON inspection_workflow_nodes
    FOR SELECT USING (
        inspection_id IN (
            SELECT id FROM inspection_entries WHERE 
                created_by = auth.uid()::text OR
                id IN (SELECT inspection_id FROM inspection_assignments WHERE user_id = auth.uid()::text) OR
                id IN (SELECT inspection_id FROM inspection_workflow_nodes WHERE executor_id = auth.uid()::text)
        )
    );

CREATE POLICY "Users can view assignments for their inspections" ON inspection_assignments
    FOR SELECT USING (
        inspection_id IN (
            SELECT id FROM inspection_entries WHERE 
                created_by = auth.uid()::text OR
                id IN (SELECT inspection_id FROM inspection_assignments WHERE user_id = auth.uid()::text) OR
                id IN (SELECT inspection_id FROM inspection_workflow_nodes WHERE executor_id = auth.uid()::text)
        )
    );

CREATE POLICY "Users can view comments for their inspections" ON inspection_comments
    FOR SELECT USING (
        inspection_id IN (
            SELECT id FROM inspection_entries WHERE 
                created_by = auth.uid()::text OR
                id IN (SELECT inspection_id FROM inspection_assignments WHERE user_id = auth.uid()::text) OR
                id IN (SELECT inspection_id FROM inspection_workflow_nodes WHERE executor_id = auth.uid()::text)
        )
    );

CREATE POLICY "Users can view workflow history for their inspections" ON inspection_workflow_history
    FOR SELECT USING (
        inspection_id IN (
            SELECT id FROM inspection_entries WHERE 
                created_by = auth.uid()::text OR
                id IN (SELECT inspection_id FROM inspection_assignments WHERE user_id = auth.uid()::text) OR
                id IN (SELECT inspection_id FROM inspection_workflow_nodes WHERE executor_id = auth.uid()::text)
        )
    ); 