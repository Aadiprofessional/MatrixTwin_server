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

// Helper to get user role
const getUserRole = async (req, userId) => {
    if (!userId) return 'user';
    const { data: member } = await req.supabase
        .from('company_members')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();
    
    if (member) return member.role;

    const { data: user } = await req.supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
    
    return user ? user.role : 'user';
};

// 1. Search API
router.get('/search', async (req, res) => {
    try {
        const { query, formType, projectId, userId } = req.query; // query can be id or project name/id
        
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const userRole = await getUserRole(req, userId);
        const isAdmin = ['admin', 'owner', 'project_manager'].includes(userRole);
        
        const config = getFormConfig();
        let results = [];
        const formTypesToSearch = formType ? [formType] : Object.keys(config);
        
        // Helper to check for UUID
        const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

        for (const type of formTypesToSearch) {
            if (!config[type]) continue;
            
            const tableName = config[type].table;
            
            // If not admin, we need to find forms assigned to user
            let assignedIds = [];
            if (!isAdmin && userId) {
                const workflowTableName = type === 'forms' ? 'form_workflow_nodes' : `${type}_workflow_nodes`;
                const foreignKey = type === 'forms' ? 'form_id' : `${type}_id`;
                
                const { data: nodes } = await req.supabase
                    .from(workflowTableName)
                    .select(foreignKey)
                    .eq('executor_id', userId);
                
                if (nodes && nodes.length > 0) {
                    assignedIds = nodes.map(n => n[foreignKey]);
                }
            }

            let queryBuilder = req.supabase
                .from(tableName)
                .select('*');

            if (projectId) {
                queryBuilder = queryBuilder.eq('project_id', projectId);
            }
            
            if (!isAdmin && userId) {
                // Filter: Created by user OR Assigned to user
                if (assignedIds.length > 0) {
                    // Use 'in' filter for IDs combined with 'or' logic?
                    // Supabase .or() syntax: 'column.operator.value,column.operator.value'
                    // For array: 'id.in.("id1","id2"),created_by.eq.userId'
                    // We need to format the IDs list for the IN filter: (id1,id2,id3)
                    const idsList = `(${assignedIds.map(id => `"${id}"`).join(',')})`;
                    queryBuilder = queryBuilder.or(`created_by.eq.${userId},id.in.${idsList}`);
                } else {
                    queryBuilder = queryBuilder.eq('created_by', userId);
                }
            }

            if (type === 'forms') {
                // For custom forms (UUID id), search in template_name or project_name
                // Only search ID if query is a valid UUID to avoid "operator does not exist: uuid ~~* unknown"
                if (isUUID(query)) {
                     queryBuilder = queryBuilder.or(`id.eq.${query},template_name.ilike.%${query}%,project_name.ilike.%${query}%`);
                } else {
                     queryBuilder = queryBuilder.or(`template_name.ilike.%${query}%,project_name.ilike.%${query}%`);
                }
            } else {
                // For other forms (Text ID), search in id or project
                queryBuilder = queryBuilder.or(`id.ilike.%${query}%,project.ilike.%${query}%`);
            }

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
        const { projectId, userId } = req.query;
        
        const userRole = await getUserRole(req, userId);
        const isAdmin = ['admin', 'owner', 'project_manager'].includes(userRole);

        const config = getFormConfig();
        const dashboardStats = {
            total_forms: 0,
            pending_total: 0,
            completed_total: 0,
            by_type: {}
        };

        const promises = Object.keys(config).map(async (type) => {
            const tableName = config[type].table;
            
            // If not admin, find assigned forms first
            let assignedIds = [];
            if (!isAdmin && userId) {
                const workflowTableName = type === 'forms' ? 'form_workflow_nodes' : `${type}_workflow_nodes`;
                const foreignKey = type === 'forms' ? 'form_id' : `${type}_id`;
                
                const { data: nodes } = await req.supabase
                    .from(workflowTableName)
                    .select(foreignKey)
                    .eq('executor_id', userId);
                
                if (nodes && nodes.length > 0) {
                    assignedIds = nodes.map(n => n[foreignKey]);
                }
            }

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

            if (!isAdmin && userId) {
                // Apply access filter: created_by = userId OR id IN assignedIds
                if (assignedIds.length > 0) {
                     const idsList = `(${assignedIds.map(id => `"${id}"`).join(',')})`;
                     const orFilter = `created_by.eq.${userId},id.in.${idsList}`;
                     
                     totalQuery = totalQuery.or(orFilter);
                     pendingQuery = pendingQuery.or(orFilter);
                     completedQuery = completedQuery.or(orFilter);
                } else {
                     totalQuery = totalQuery.eq('created_by', userId);
                     pendingQuery = pendingQuery.eq('created_by', userId);
                     completedQuery = completedQuery.eq('created_by', userId);
                }
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
        const { projectId, userId } = req.query;
        const config = getFormConfig();
        const pendingCounts = {};

        if (!userId) {
            return res.json({});
        }

        // Fetch user role if userId is provided
        let userRole = 'user';
        if (userId) {
            // Check company_members first, then users table
            const { data: member } = await req.supabase
                .from('company_members')
                .select('role')
                .eq('user_id', userId)
                .maybeSingle();
            
            if (member) {
                userRole = member.role;
            } else {
                const { data: user } = await req.supabase
                    .from('users')
                    .select('role')
                    .eq('id', userId)
                    .maybeSingle();
                if (user) userRole = user.role;
            }
        }

        const isAdmin = ['admin', 'owner', 'project_manager'].includes(userRole);

        const promises = Object.keys(config).map(async (type) => {
            const tableName = config[type].table;
            
            // Construct workflow table name: e.g. diary_workflow_nodes
            const workflowTableName = `${type}_workflow_nodes`;
            
            let wfTable = workflowTableName;
            let foreignKey = `${type}_id`;
            if (type === 'forms') {
                wfTable = 'form_workflow_nodes';
                foreignKey = 'form_id';
            }

            // We need to count pending workflow nodes assigned to this user.
            
            let query = req.supabase
                .from(wfTable)
                .select(foreignKey, { count: 'exact', head: true })
                .eq('status', 'pending');
            
            if (!isAdmin) {
                // If not admin, restrict to tasks assigned to this user
                query = query.eq('executor_id', userId);
            }
            // If admin, show all pending tasks regardless of assignment

            if (projectId) {
                // Join with parent table to filter by project_id
                
                // Correct syntax for count with join filter:
                let joinQuery = req.supabase
                    .from(wfTable)
                    .select(`${foreignKey}, ${config[type].table}!inner(project_id)`, { count: 'exact', head: true })
                    .eq('status', 'pending')
                    .eq(`${config[type].table}.project_id`, projectId);
                
                if (!isAdmin) {
                    joinQuery = joinQuery.eq('executor_id', userId);
                }

                const { count, error } = await joinQuery;

                 if (error) {
                    // console.error(`Error fetching pending count for ${type} (with project):`, error);
                    return { type, count: 0 };
                }
                return { type, count: count || 0 };

            } else {
                // Simple query on workflow table if no project filter
                const { count, error } = await query;
                
                if (error) {
                    // console.error(`Error fetching pending count for ${type}:`, error);
                    return { type, count: 0 };
                }
                return { type, count: count || 0 };
            }
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
