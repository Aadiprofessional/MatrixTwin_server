-- Add node_order to history tables to track workflow state
ALTER TABLE diary_entry_history ADD COLUMN IF NOT EXISTS node_order INTEGER;
ALTER TABLE labour_entry_history ADD COLUMN IF NOT EXISTS node_order INTEGER;
ALTER TABLE safety_entry_history ADD COLUMN IF NOT EXISTS node_order INTEGER;
ALTER TABLE cleansing_entry_history ADD COLUMN IF NOT EXISTS node_order INTEGER;
ALTER TABLE survey_entry_history ADD COLUMN IF NOT EXISTS node_order INTEGER;
ALTER TABLE inspection_entry_history ADD COLUMN IF NOT EXISTS node_order INTEGER;
ALTER TABLE form_entry_history ADD COLUMN IF NOT EXISTS node_order INTEGER;
