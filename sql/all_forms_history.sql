-- 1. Labour History
CREATE TABLE IF NOT EXISTS labour_entry_history (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    labour_id TEXT REFERENCES labour_entries(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    form_data JSONB,
    change_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_labour_history_labour_id ON labour_entry_history(labour_id);
CREATE INDEX IF NOT EXISTS idx_labour_history_changed_at ON labour_entry_history(changed_at DESC);

-- 2. Safety History
CREATE TABLE IF NOT EXISTS safety_entry_history (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    safety_id TEXT REFERENCES safety_entries(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    form_data JSONB,
    change_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_safety_history_safety_id ON safety_entry_history(safety_id);
CREATE INDEX IF NOT EXISTS idx_safety_history_changed_at ON safety_entry_history(changed_at DESC);

-- 3. Cleansing History
CREATE TABLE IF NOT EXISTS cleansing_entry_history (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    cleansing_id TEXT REFERENCES cleansing_entries(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    form_data JSONB,
    change_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cleansing_history_cleansing_id ON cleansing_entry_history(cleansing_id);
CREATE INDEX IF NOT EXISTS idx_cleansing_history_changed_at ON cleansing_entry_history(changed_at DESC);

-- 4. Survey History
CREATE TABLE IF NOT EXISTS survey_entry_history (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    survey_id TEXT REFERENCES survey_entries(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    form_data JSONB,
    change_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_survey_history_survey_id ON survey_entry_history(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_history_changed_at ON survey_entry_history(changed_at DESC);

-- 5. Inspection History
CREATE TABLE IF NOT EXISTS inspection_entry_history (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    inspection_id TEXT REFERENCES inspection_entries(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    form_data JSONB,
    change_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_inspection_history_inspection_id ON inspection_entry_history(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_history_changed_at ON inspection_entry_history(changed_at DESC);

-- 6. Custom Forms History
CREATE TABLE IF NOT EXISTS form_entry_history (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    form_entry_id UUID REFERENCES form_entries(id) ON DELETE CASCADE, -- Note: form_entries usually uses UUID
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    form_data JSONB,
    change_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_form_history_entry_id ON form_entry_history(form_entry_id);
CREATE INDEX IF NOT EXISTS idx_form_history_changed_at ON form_entry_history(changed_at DESC);
