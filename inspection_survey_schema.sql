
-- INSPECTION MODULE TABLES

-- 1. Inspection Entries
CREATE TABLE IF NOT EXISTS inspection_entries (
    id TEXT PRIMARY KEY,
    date DATE,
    project TEXT,
    project_id TEXT,
    inspector TEXT,
    contract_no TEXT,
    risc_no TEXT,
    revision TEXT,
    supervisor TEXT,
    attention TEXT,
    location TEXT,
    works_to_be_inspected TEXT,
    works_category TEXT,
    inspection_time TEXT,
    next_operation TEXT,
    general_cleaning TEXT,
    scheduled_time TEXT,
    scheduled_date DATE,
    equipment TEXT,
    no_objection BOOLEAN DEFAULT FALSE,
    deficiencies_noted BOOLEAN DEFAULT FALSE,
    deficiencies JSONB DEFAULT '[]'::jsonb,
    form_data JSONB DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT
);

-- 2. Inspection Workflow Nodes
CREATE TABLE IF NOT EXISTS inspection_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id TEXT REFERENCES inspection_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES auth.users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'pending', -- pending, waiting, completed, rejected, sent_back
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}'::jsonb,
    expire_time TIMESTAMPTZ,
    expire_duration INTEGER,
    completed_by UUID REFERENCES auth.users(id),
    completed_at TIMESTAMPTZ,
    completion_count INTEGER DEFAULT 0,
    last_completed_at TIMESTAMPTZ,
    can_re_edit BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Inspection Assignments (CC recipients)
CREATE TABLE IF NOT EXISTS inspection_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id TEXT REFERENCES inspection_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT DEFAULT 'cc',
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Inspection Comments
CREATE TABLE IF NOT EXISTS inspection_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id TEXT REFERENCES inspection_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    comment TEXT,
    action TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Inspection Workflow History
CREATE TABLE IF NOT EXISTS inspection_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id TEXT REFERENCES inspection_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_order INTEGER,
    action TEXT,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for Inspection tables
CREATE INDEX IF NOT EXISTS idx_inspection_entries_project_id ON inspection_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_inspection_entries_created_by ON inspection_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_inspection_workflow_nodes_inspection_id ON inspection_workflow_nodes(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_assignments_inspection_id ON inspection_assignments(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_assignments_user_id ON inspection_assignments(user_id);


-- SURVEY MODULE TABLES

-- 1. Survey Entries
CREATE TABLE IF NOT EXISTS survey_entries (
    id TEXT PRIMARY KEY,
    date DATE,
    project TEXT,
    project_id TEXT,
    surveyor TEXT,
    contract_no TEXT,
    risc_no TEXT,
    revision TEXT,
    supervisor TEXT,
    attention TEXT,
    location TEXT,
    survey_field TEXT,
    works_category TEXT,
    survey_time TEXT,
    next_operation TEXT,
    scheduled_time TEXT,
    scheduled_date DATE,
    equipment TEXT,
    no_objection BOOLEAN DEFAULT FALSE,
    deficiencies_noted BOOLEAN DEFAULT FALSE,
    deficiencies JSONB DEFAULT '[]'::jsonb,
    form_data JSONB DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT
);

-- 2. Survey Workflow Nodes
CREATE TABLE IF NOT EXISTS survey_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id TEXT REFERENCES survey_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES auth.users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'pending', -- pending, waiting, completed, rejected, sent_back
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}'::jsonb,
    expire_time TIMESTAMPTZ,
    expire_duration INTEGER,
    completed_by UUID REFERENCES auth.users(id),
    completed_at TIMESTAMPTZ,
    completion_count INTEGER DEFAULT 0,
    last_completed_at TIMESTAMPTZ,
    can_re_edit BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Survey Assignments (CC recipients)
CREATE TABLE IF NOT EXISTS survey_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id TEXT REFERENCES survey_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT DEFAULT 'cc',
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Survey Comments
CREATE TABLE IF NOT EXISTS survey_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id TEXT REFERENCES survey_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    comment TEXT,
    action TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Survey Workflow History
CREATE TABLE IF NOT EXISTS survey_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id TEXT REFERENCES survey_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_order INTEGER,
    action TEXT,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for Survey tables
CREATE INDEX IF NOT EXISTS idx_survey_entries_project_id ON survey_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_survey_entries_created_by ON survey_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_survey_workflow_nodes_survey_id ON survey_workflow_nodes(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_assignments_survey_id ON survey_assignments(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_assignments_user_id ON survey_assignments(user_id);
