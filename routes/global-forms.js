const express = require('express');
const router = express.Router();

// Helper function to get form types and their corresponding table names
const getFormConfig = () => ({
    diary: { table: 'diary_entries', label: 'Diary' },
    inspection: { table: 'inspection_entries', label: 'Inspection' },
    labour: { table: 'labour_entries', label: 'Labour' },
    safety: { table: 'safety_entries', label: 'Safety' },
    survey: { table: 'survey_entries', label: 'Survey' },
    cleansing: { table: 'cleansing_entries', label: 'Cleansing' },
    forms: { table: 'form_entries', label: 'Custom Forms' } // Assuming 'forms' refers to general/custom forms
});

// 1. Search API
router.get('/search', async (req, res) => {
    try {
        const { query, formType, projectId } = req.query; // query can be id or project name/id
        
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const config = getFormConfig();
        let results = [];
        const formTypesToSearch = formType ? [formType] : Object.keys(config);

        for (const type of formTypesToSearch) {
            if (!config[type]) continue;
            
            const tableName = config[type].table;
            
            // Build query to search by ID or Project (assuming project/project_id columns exist)
            // Note: Some tables use 'project' (name) and 'project_id', others might vary.
            // Based on schema, most have 'id', 'project', 'project_id'.
            // Custom forms (form_entries) has 'template_name' instead of project sometimes, but schema says project_id/project_name exist.
            
            let queryBuilder = req.supabase
                .from(tableName)
                .select('*');

            if (projectId) {
                queryBuilder = queryBuilder.eq('project_id', projectId);
            }

            if (type === 'forms') {
                // For custom forms, search in template_name or project_name
                queryBuilder = queryBuilder.or(`id.ilike.%${query}%,template_name.ilike.%${query}%,project_name.ilike.%${query}%`);
            } else {
                // For other forms, search in id or project
                queryBuilder = queryBuilder.or(`id.ilike.%${query}%,project.ilike.%${query}%`);
            }
            
            // Add status filter if provided (optional, not requested but good practice)
            // if (req.query.status) queryBuilder = queryBuilder.eq('status', req.query.status);

            const { data, error } = await queryBuilder.limit(20);

            if (error) {
                console.error(`Error searching ${type}:`, error);
                continue; 
            }

            if (data && data.length > 0) {
                results.push(...data.map(item => ({
                    ...item,
                    form_type: type,
                    form_label: config[type].label
                })));
            }
        }

        res.json(results);

    } catch (error) {
        console.error('Search API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 2. Dashboard API - Aggregate stats
router.get('/dashboard', async (req, res) => {
    try {
        const { projectId } = req.query;
        const config = getFormConfig();
        const dashboardStats = {
            total_forms: 0,
            pending_total: 0,
            completed_total: 0,
            by_type: {}
        };

        const promises = Object.keys(config).map(async (type) => {
            const tableName = config[type].table;
            
            // Get counts for this form type
            // We'll get total, pending, and completed
            // Using multiple queries or a single query with grouping might be heavy, 
            // but for a dashboard, we want summary.
            // Let's do simple counts.
            
            let totalQuery = req.supabase
                .from(tableName)
                .select('*', { count: 'exact', head: true });
            
            let pendingQuery = req.supabase
                .from(tableName)
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending');
            
            let completedQuery = req.supabase
                .from(tableName)
                .select('*', { count: 'exact', head: true })
                .neq('status', 'pending');

            if (projectId) {
                totalQuery = totalQuery.eq('project_id', projectId);
                pendingQuery = pendingQuery.eq('project_id', projectId);
                completedQuery = completedQuery.eq('project_id', projectId);
            }

            const { count: total, error: totalError } = await totalQuery;
            const { count: pending, error: pendingError } = await pendingQuery;
            const { count: completed, error: completedError } = await completedQuery;

            if (totalError) console.error(`Error fetching stats for ${type}:`, totalError);

            return {
                type,
                label: config[type].label,
                total: total || 0,
                pending: pending || 0,
                completed: completed || 0
            };
        });

        const results = await Promise.all(promises);

        results.forEach(stat => {
            dashboardStats.by_type[stat.type] = stat;
            dashboardStats.total_forms += stat.total;
            dashboardStats.pending_total += stat.pending;
            dashboardStats.completed_total += stat.completed;
        });

        res.json(dashboardStats);

    } catch (error) {
        console.error('Dashboard API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 3. Pending Forms API - Just counts for sidebar
router.get('/pending-counts', async (req, res) => {
    try {
        const { projectId } = req.query;
        const config = getFormConfig();
        const pendingCounts = {};

        const promises = Object.keys(config).map(async (type) => {
            const tableName = config[type].table;
            
            let query = req.supabase
                .from(tableName)
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending');

            if (projectId) {
                query = query.eq('project_id', projectId);
            }

            const { count, error } = await query;

            if (error) {
                console.error(`Error fetching pending count for ${type}:`, error);
                return { type, count: 0 };
            }

            return { type, count: count || 0 };
        });

        const results = await Promise.all(promises);

        results.forEach(item => {
            pendingCounts[item.type] = item.count;
        });

        res.json(pendingCounts);

    } catch (error) {
        console.error('Pending Counts API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
