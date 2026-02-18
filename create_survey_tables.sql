-- Create survey_entries table
CREATE TABLE IF NOT EXISTS survey_entries (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    project TEXT NOT NULL,
    project_id TEXT,
    surveyor TEXT NOT NULL,
    contract_no TEXT,
    risc_no TEXT,
    revision TEXT,
    supervisor TEXT,
    attention TEXT,
    location TEXT,
    survey_field TEXT,
    surveyed_by TEXT,
    surveyed_at TIMESTAMP WITH TIME ZONE,
    works_category TEXT DEFAULT 'General',
    survey_time TEXT,
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

-- Create survey_workflow_nodes table
CREATE TABLE IF NOT EXISTS survey_workflow_nodes (
    id SERIAL PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES survey_entries(id) ON DELETE CASCADE,
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

-- Create survey_assignments table
CREATE TABLE IF NOT EXISTS survey_assignments (
    id SERIAL PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES survey_entries(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('executor', 'cc')),
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create survey_comments table
CREATE TABLE IF NOT EXISTS survey_comments (
    id SERIAL PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES survey_entries(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    comment TEXT NOT NULL,
    action TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create survey_workflow_history table
CREATE TABLE IF NOT EXISTS survey_workflow_history (
    id SERIAL PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES survey_entries(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    node_order INTEGER NOT NULL,
    action TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    comment TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_survey_entries_created_by ON survey_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_survey_entries_project_id ON survey_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_survey_entries_status ON survey_entries(status);
CREATE INDEX IF NOT EXISTS idx_survey_entries_created_at ON survey_entries(created_at);

CREATE INDEX IF NOT EXISTS idx_survey_workflow_nodes_survey_id ON survey_workflow_nodes(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_workflow_nodes_executor_id ON survey_workflow_nodes(executor_id);
CREATE INDEX IF NOT EXISTS idx_survey_workflow_nodes_status ON survey_workflow_nodes(status);

CREATE INDEX IF NOT EXISTS idx_survey_assignments_survey_id ON survey_assignments(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_assignments_user_id ON survey_assignments(user_id);

CREATE INDEX IF NOT EXISTS idx_survey_comments_survey_id ON survey_comments(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_workflow_history_survey_id ON survey_workflow_history(survey_id);

-- Enable RLS (Row Level Security)
ALTER TABLE survey_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_workflow_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_workflow_history ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (basic policies - adjust based on your security requirements)
CREATE POLICY "Users can view their own survey entries" ON survey_entries
    FOR SELECT USING (auth.uid()::text = created_by);

CREATE POLICY "Users can view survey entries they are assigned to" ON survey_entries
    FOR SELECT USING (
        id IN (
            SELECT survey_id FROM survey_assignments WHERE user_id = auth.uid()::text
        )
    );

CREATE POLICY "Users can view survey entries they are executors for" ON survey_entries
    FOR SELECT USING (
        id IN (
            SELECT survey_id FROM survey_workflow_nodes WHERE executor_id = auth.uid()::text
        )
    );

-- Similar policies for other tables
CREATE POLICY "Users can view workflow nodes for their surveys" ON survey_workflow_nodes
    FOR SELECT USING (
        survey_id IN (
            SELECT id FROM survey_entries WHERE 
                created_by = auth.uid()::text OR
                id IN (SELECT survey_id FROM survey_assignments WHERE user_id = auth.uid()::text) OR
                id IN (SELECT survey_id FROM survey_workflow_nodes WHERE executor_id = auth.uid()::text)
        )
    );

CREATE POLICY "Users can view assignments for their surveys" ON survey_assignments
    FOR SELECT USING (
        survey_id IN (
            SELECT id FROM survey_entries WHERE 
                created_by = auth.uid()::text OR
                id IN (SELECT survey_id FROM survey_assignments WHERE user_id = auth.uid()::text) OR
                id IN (SELECT survey_id FROM survey_workflow_nodes WHERE executor_id = auth.uid()::text)
        )
    );

CREATE POLICY "Users can view comments for their surveys" ON survey_comments
    FOR SELECT USING (
        survey_id IN (
            SELECT id FROM survey_entries WHERE 
                created_by = auth.uid()::text OR
                id IN (SELECT survey_id FROM survey_assignments WHERE user_id = auth.uid()::text) OR
                id IN (SELECT survey_id FROM survey_workflow_nodes WHERE executor_id = auth.uid()::text)
        )
    );

CREATE POLICY "Users can view workflow history for their surveys" ON survey_workflow_history
    FOR SELECT USING (
        survey_id IN (
            SELECT id FROM survey_entries WHERE 
                created_by = auth.uid()::text OR
                id IN (SELECT survey_id FROM survey_assignments WHERE user_id = auth.uid()::text) OR
                id IN (SELECT survey_id FROM survey_workflow_nodes WHERE executor_id = auth.uid()::text)
        )
    ); 