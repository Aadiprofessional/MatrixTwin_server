-- Safety Module Tables

-- Safety Entries Table
CREATE TABLE IF NOT EXISTS safety_entries (
    id TEXT PRIMARY KEY,
    date DATE,
    project TEXT,
    project_id TEXT,
    inspector TEXT,
    inspection_type TEXT,
    safety_score INTEGER,
    findings_count INTEGER,
    incidents_reported TEXT,
    corrective_actions TEXT,
    notes TEXT,
    form_data JSONB,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT
);

-- Safety Workflow Nodes Table
CREATE TABLE IF NOT EXISTS safety_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    safety_id TEXT REFERENCES safety_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES auth.users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'pending',
    edit_access BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}',
    expire_time TIMESTAMPTZ,
    expire_duration INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- Safety Assignments Table
CREATE TABLE IF NOT EXISTS safety_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    safety_id TEXT REFERENCES safety_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT,
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safety Comments Table
CREATE TABLE IF NOT EXISTS safety_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    safety_id TEXT REFERENCES safety_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safety Workflow History Table
CREATE TABLE IF NOT EXISTS safety_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    safety_id TEXT REFERENCES safety_entries(id) ON DELETE CASCADE,
    action TEXT,
    actor_id UUID REFERENCES auth.users(id),
    actor_name TEXT,
    previous_status TEXT,
    new_status TEXT,
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Labour Module Tables

-- Labour Entries Table
CREATE TABLE IF NOT EXISTS labour_entries (
    id TEXT PRIMARY KEY,
    date DATE,
    project TEXT,
    project_id TEXT,
    submitter TEXT,
    labour_type TEXT,
    trade_type TEXT,
    number_of_workers INTEGER,
    hours_worked NUMERIC,
    work_description TEXT,
    notes TEXT,
    form_data JSONB,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT
);

-- Labour Workflow Nodes Table
CREATE TABLE IF NOT EXISTS labour_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    labour_id TEXT REFERENCES labour_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES auth.users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'pending',
    edit_access BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}',
    expire_time TIMESTAMPTZ,
    expire_duration INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- Labour Assignments Table
CREATE TABLE IF NOT EXISTS labour_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    labour_id TEXT REFERENCES labour_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT,
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Labour Comments Table
CREATE TABLE IF NOT EXISTS labour_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    labour_id TEXT REFERENCES labour_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Labour Workflow History Table
CREATE TABLE IF NOT EXISTS labour_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    labour_id TEXT REFERENCES labour_entries(id) ON DELETE CASCADE,
    action TEXT,
    actor_id UUID REFERENCES auth.users(id),
    actor_name TEXT,
    previous_status TEXT,
    new_status TEXT,
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cleansing Module Tables

-- Cleansing Entries Table
CREATE TABLE IF NOT EXISTS cleansing_entries (
    id TEXT PRIMARY KEY,
    date DATE,
    project TEXT,
    project_id TEXT,
    inspector TEXT,
    area TEXT,
    cleanliness_score INTEGER,
    cleaning_status TEXT DEFAULT 'pending',
    areas_cleaned TEXT,
    waste_removed TEXT,
    notes TEXT,
    form_data JSONB,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT
);

-- Cleansing Workflow Nodes Table
CREATE TABLE IF NOT EXISTS cleansing_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cleansing_id TEXT REFERENCES cleansing_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES auth.users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'pending',
    edit_access BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}',
    expire_time TIMESTAMPTZ,
    expire_duration INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- Cleansing Assignments Table
CREATE TABLE IF NOT EXISTS cleansing_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cleansing_id TEXT REFERENCES cleansing_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT,
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cleansing Comments Table
CREATE TABLE IF NOT EXISTS cleansing_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cleansing_id TEXT REFERENCES cleansing_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name TEXT,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cleansing Workflow History Table
CREATE TABLE IF NOT EXISTS cleansing_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cleansing_id TEXT REFERENCES cleansing_entries(id) ON DELETE CASCADE,
    action TEXT,
    actor_id UUID REFERENCES auth.users(id),
    actor_name TEXT,
    previous_status TEXT,
    new_status TEXT,
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for better performance

-- Safety Indexes
CREATE INDEX IF NOT EXISTS idx_safety_entries_project_id ON safety_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_safety_entries_created_by ON safety_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_safety_entries_status ON safety_entries(status);
CREATE INDEX IF NOT EXISTS idx_safety_workflow_nodes_safety_id ON safety_workflow_nodes(safety_id);
CREATE INDEX IF NOT EXISTS idx_safety_assignments_safety_id ON safety_assignments(safety_id);
CREATE INDEX IF NOT EXISTS idx_safety_comments_safety_id ON safety_comments(safety_id);
CREATE INDEX IF NOT EXISTS idx_safety_workflow_history_safety_id ON safety_workflow_history(safety_id);

-- Labour Indexes
CREATE INDEX IF NOT EXISTS idx_labour_entries_project_id ON labour_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_labour_entries_created_by ON labour_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_labour_entries_status ON labour_entries(status);
CREATE INDEX IF NOT EXISTS idx_labour_workflow_nodes_labour_id ON labour_workflow_nodes(labour_id);
CREATE INDEX IF NOT EXISTS idx_labour_assignments_labour_id ON labour_assignments(labour_id);
CREATE INDEX IF NOT EXISTS idx_labour_comments_labour_id ON labour_comments(labour_id);
CREATE INDEX IF NOT EXISTS idx_labour_workflow_history_labour_id ON labour_workflow_history(labour_id);

-- Cleansing Indexes
CREATE INDEX IF NOT EXISTS idx_cleansing_entries_project_id ON cleansing_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_cleansing_entries_created_by ON cleansing_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_cleansing_entries_status ON cleansing_entries(status);
CREATE INDEX IF NOT EXISTS idx_cleansing_workflow_nodes_cleansing_id ON cleansing_workflow_nodes(cleansing_id);
CREATE INDEX IF NOT EXISTS idx_cleansing_assignments_cleansing_id ON cleansing_assignments(cleansing_id);
CREATE INDEX IF NOT EXISTS idx_cleansing_comments_cleansing_id ON cleansing_comments(cleansing_id);
CREATE INDEX IF NOT EXISTS idx_cleansing_workflow_history_cleansing_id ON cleansing_workflow_history(cleansing_id);
