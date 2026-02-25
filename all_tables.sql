-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- Core & Auth Tables
-- ==========================================

-- Users Table (Public profile)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    email TEXT,
    name TEXT,
    role TEXT DEFAULT 'user',
    avatar TEXT,
    phone TEXT,
    company_id UUID,
    is_super_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_sign_in_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

-- Companies Table
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT,
    details JSONB DEFAULT '{}',
    admin_id UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Company Members Table
CREATE TABLE IF NOT EXISTS company_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(company_id, user_id)
);

-- Company Join Requests Table
CREATE TABLE IF NOT EXISTS company_join_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'upcoming',
    location TEXT,
    client TEXT,
    deadline TIMESTAMPTZ,
    image_url TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Project Members Table
CREATE TABLE IF NOT EXISTS project_members (
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);

-- Admin Requests Table
CREATE TABLE IF NOT EXISTS admin_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    company_name TEXT NOT NULL,
    company_details JSONB DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    rejection_reason TEXT,
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    message TEXT,
    type TEXT,
    form_type TEXT,
    form_id TEXT,
    project_id TEXT,
    action_url TEXT,
    metadata JSONB DEFAULT '{}',
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Sessions Table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    project_id TEXT,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Messages Table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    sender TEXT NOT NULL,
    image_url TEXT,
    is_streaming BOOLEAN DEFAULT FALSE,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Module: Diary
-- ==========================================

CREATE TABLE IF NOT EXISTS diary_entries (
    id TEXT PRIMARY KEY,
    date DATE,
    project TEXT,
    project_id TEXT,
    author TEXT,
    weather TEXT,
    temperature TEXT,
    work_completed TEXT,
    incidents_reported TEXT,
    materials_delivered TEXT,
    notes TEXT,
    form_data JSONB,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT
);

CREATE TABLE IF NOT EXISTS diary_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diary_id TEXT REFERENCES diary_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'waiting',
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',
    expire_time TIMESTAMPTZ,
    expire_duration TEXT,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    completion_count INTEGER DEFAULT 0,
    last_completed_at TIMESTAMPTZ,
    can_re_edit BOOLEAN DEFAULT TRUE,
    max_completions INTEGER DEFAULT 2,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diary_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diary_id TEXT REFERENCES diary_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT DEFAULT 'cc',
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diary_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diary_id TEXT REFERENCES diary_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    comment TEXT,
    action TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diary_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diary_id TEXT REFERENCES diary_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_order INTEGER,
    action TEXT,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Module: Inspection
-- ==========================================

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
    deficiencies JSONB DEFAULT '[]',
    form_data JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT
);

CREATE TABLE IF NOT EXISTS inspection_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id TEXT REFERENCES inspection_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'pending',
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',
    expire_time TIMESTAMPTZ,
    expire_duration INTEGER,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    completion_count INTEGER DEFAULT 0,
    last_completed_at TIMESTAMPTZ,
    can_re_edit BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inspection_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id TEXT REFERENCES inspection_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT DEFAULT 'cc',
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inspection_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id TEXT REFERENCES inspection_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    comment TEXT,
    action TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inspection_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id TEXT REFERENCES inspection_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_order INTEGER,
    action TEXT,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Module: Labour
-- ==========================================

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
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT
);

CREATE TABLE IF NOT EXISTS labour_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    labour_id TEXT REFERENCES labour_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'pending',
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',
    expire_time TIMESTAMPTZ,
    expire_duration INTEGER,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    completion_count INTEGER DEFAULT 0,
    last_completed_at TIMESTAMPTZ,
    can_re_edit BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS labour_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    labour_id TEXT REFERENCES labour_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT,
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS labour_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    labour_id TEXT REFERENCES labour_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS labour_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    labour_id TEXT REFERENCES labour_entries(id) ON DELETE CASCADE,
    action TEXT,
    actor_id UUID REFERENCES users(id),
    actor_name TEXT,
    previous_status TEXT,
    new_status TEXT,
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Module: Safety
-- ==========================================

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
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT
);

CREATE TABLE IF NOT EXISTS safety_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    safety_id TEXT REFERENCES safety_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'pending',
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',
    expire_time TIMESTAMPTZ,
    expire_duration INTEGER,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    completion_count INTEGER DEFAULT 0,
    last_completed_at TIMESTAMPTZ,
    can_re_edit BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS safety_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    safety_id TEXT REFERENCES safety_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT,
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS safety_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    safety_id TEXT REFERENCES safety_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS safety_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    safety_id TEXT REFERENCES safety_entries(id) ON DELETE CASCADE,
    action TEXT,
    actor_id UUID REFERENCES users(id),
    actor_name TEXT,
    previous_status TEXT,
    new_status TEXT,
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Module: Survey
-- ==========================================

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
    deficiencies JSONB DEFAULT '[]',
    form_data JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT
);

CREATE TABLE IF NOT EXISTS survey_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id TEXT REFERENCES survey_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'pending',
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',
    expire_time TIMESTAMPTZ,
    expire_duration INTEGER,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    completion_count INTEGER DEFAULT 0,
    last_completed_at TIMESTAMPTZ,
    can_re_edit BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS survey_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id TEXT REFERENCES survey_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT DEFAULT 'cc',
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS survey_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id TEXT REFERENCES survey_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    comment TEXT,
    action TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS survey_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id TEXT REFERENCES survey_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_order INTEGER,
    action TEXT,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Module: Cleansing
-- ==========================================

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
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 1,
    current_active_node TEXT
);

CREATE TABLE IF NOT EXISTS cleansing_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cleansing_id TEXT REFERENCES cleansing_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'pending',
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',
    expire_time TIMESTAMPTZ,
    expire_duration INTEGER,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    completion_count INTEGER DEFAULT 0,
    last_completed_at TIMESTAMPTZ,
    can_re_edit BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cleansing_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cleansing_id TEXT REFERENCES cleansing_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT,
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cleansing_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cleansing_id TEXT REFERENCES cleansing_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cleansing_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cleansing_id TEXT REFERENCES cleansing_entries(id) ON DELETE CASCADE,
    action TEXT,
    actor_id UUID REFERENCES users(id),
    actor_name TEXT,
    previous_status TEXT,
    new_status TEXT,
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Module: Custom Forms
-- ==========================================

CREATE TABLE IF NOT EXISTS form_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    form_structure JSONB DEFAULT '{}',
    project_id TEXT,
    created_by UUID REFERENCES users(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS form_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID REFERENCES form_templates(id),
    template_name TEXT,
    project_id TEXT,
    project_name TEXT,
    form_data JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER,
    current_active_node TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS form_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID REFERENCES form_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'pending',
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS form_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID REFERENCES form_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    comment TEXT,
    action TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Note: This table may be used by both Custom Forms and File Forms.
-- We use a flexible schema to support both usages if possible, or distinct tables if names collided.
-- Based on usage, we'll create a superset.
CREATE TABLE IF NOT EXISTS form_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID, -- Can reference form_entries(id) or forms(id)
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT,
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Module: File Forms (Legacy/Simple)
-- ==========================================

CREATE TABLE IF NOT EXISTS forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT,
    created_by UUID REFERENCES users(id),
    name TEXT,
    description TEXT,
    form_type TEXT,
    priority TEXT,
    file_url TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "user-avatars" (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    avatar_url TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Module: Templates (General)
-- ==========================================

CREATE TABLE IF NOT EXISTS template_entries (
    id TEXT PRIMARY KEY,
    date DATE,
    project TEXT,
    project_id TEXT,
    creator TEXT,
    template_name TEXT,
    template_type TEXT,
    description TEXT,
    template_data JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    form_data JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    current_node_index INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS template_workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id TEXT REFERENCES template_entries(id) ON DELETE CASCADE,
    node_id TEXT,
    node_type TEXT,
    node_name TEXT,
    executor_id UUID REFERENCES users(id),
    executor_name TEXT,
    node_order INTEGER,
    status TEXT DEFAULT 'waiting',
    edit_access BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',
    expire_time TIMESTAMPTZ,
    expire_duration TEXT,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    completion_count INTEGER DEFAULT 0,
    last_completed_at TIMESTAMPTZ,
    can_re_edit BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS template_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id TEXT REFERENCES template_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    user_email TEXT,
    role TEXT DEFAULT 'cc',
    node_id TEXT,
    node_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS template_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id TEXT REFERENCES template_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    comment TEXT,
    action TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Module: BIMFace
-- ==========================================

CREATE TABLE IF NOT EXISTS bim_process_logs (
    id TEXT PRIMARY KEY, -- fileId
    user_id UUID REFERENCES users(id),
    status TEXT,
    progress NUMERIC,
    step TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);
