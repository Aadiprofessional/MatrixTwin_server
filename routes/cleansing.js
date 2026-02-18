const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { Resend } = require('resend');
const { createFormAssignmentNotifications } = require('./notifications');

// Initialize Resend with API key
const resend = new Resend('re_CYa5oG13_ECrEJT5L42u1VydajXWK6W8s');

// Middleware to temporarily disable RLS for cleansing operations
const disableRLS = async (req, res, next) => {
  try {
    // Create a new supabase client with service role key for bypassing RLS
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || 'https://ahtardktcamfwgjuwmeb.supabase.co';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFodGFyZGt0Y2FtZndnanV3bWViIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjE4NzI5NCwiZXhwIjoyMDQ3NzYzMjk0fQ.YCJJhJGJJGJJGJJGJJGJJGJJGJJGJJGJJGJJGJJGJJG';
    
    req.supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    next();
  } catch (error) {
    console.error('Error setting up admin client:', error);
    next();
  }
};

/**
 * @route   POST /api/cleansing/create
 * @desc    Create a new cleansing entry with workflow
 * @access  Private/Admin
 */
router.post('/create', auth, disableRLS, async (req, res) => {
  try {
    const { 
      formData, 
      processNodes, 
      createdBy,
      projectId
    } = req.body;

    console.log('=== CLEANSING CREATION START ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const supabase = req.supabaseAdmin || req.supabase;

    // Validate admin role
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role, name, email')
      .eq('id', createdBy)
      .single();

    if (userError || !user) {
      console.error('User validation failed:', userError);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('Creator user:', user);

    if (user.role !== 'admin') {
      console.error('Non-admin user attempted to create cleansing entry:', user);
      return res.status(403).json({ error: 'Only admins can create cleansing entries' });
    }

    // Create cleansing entry
    const cleansingEntry = {
      id: `cleansing_${Date.now()}`,
      date: formData.inspectionDate || new Date().toISOString().split('T')[0],
      project: formData.projectId || 'Unknown Project',
      project_id: projectId,
      inspector: user.name,
      area: formData.areaInspected || '',
      cleanliness_score: parseInt(formData.cleanlinessScore?.replace('%', '')) || 0,
      cleaning_status: formData.cleaningStatus || 'pending',
      areas_cleaned: formData.areasRequiringCleaning || '',
      waste_removed: formData.wasteRemovalRequired || '',
      notes: formData.additionalNotes || '',
      form_data: formData,
      created_by: createdBy,
      created_at: new Date().toISOString(),
      status: 'pending',
      current_node_index: 1,
      current_active_node: processNodes.find(n => n.type === 'node')?.id || null
    };

    console.log('Cleansing entry to insert:', cleansingEntry);

    // Insert cleansing entry
    const { data: insertedCleansing, error: cleansingError } = await supabase
      .from('cleansing_entries')
      .insert([cleansingEntry])
      .select()
      .single();

    if (cleansingError) {
      console.error('Failed to insert cleansing entry:', cleansingError);
      throw cleansingError;
    }

    console.log('Cleansing entry inserted successfully:', insertedCleansing);

    // Create workflow nodes with proper executor ID lookup and logging
    const workflowNodes = [];
    for (let index = 0; index < processNodes.length; index++) {
      const node = processNodes[index];
      let executorId = null;
      let executorName = null;

      console.log(`Processing node ${index}:`, node);

      // Look up executor by ID if provided, otherwise by name
      if (node.executorId) {
        console.log(`Looking up executor by ID: ${node.executorId}`);
        const { data: executor, error: executorError } = await supabase
          .from('users')
          .select('id, name, email')
          .eq('id', node.executorId)
          .single();
        
        if (executorError) {
          console.error(`Failed to find executor by ID ${node.executorId}:`, executorError);
        } else if (executor) {
          executorId = executor.id;
          executorName = executor.name;
          console.log(`Found executor by ID:`, executor);
        }
      } else if (node.executorName || node.executor) {
        const executorNameToSearch = node.executorName || node.executor;
        console.log(`Looking up executor by name: ${executorNameToSearch}`);
        const { data: executor, error: executorError } = await supabase
          .from('users')
          .select('id, name, email')
          .eq('name', executorNameToSearch)
          .single();
        
        if (executorError) {
          console.error(`Failed to find executor by name ${executorNameToSearch}:`, executorError);
        } else if (executor) {
          executorId = executor.id;
          executorName = executor.name;
          console.log(`Found executor by name:`, executor);
        }
      }

      const workflowNode = {
      cleansing_id: insertedCleansing.id,
      node_id: node.id,
      node_type: node.type,
      node_name: node.name,
        executor_id: executorId,
        executor_name: executorName,
      node_order: index,
      status: index === 1 ? 'pending' : 'waiting',
        edit_access: node.editAccess !== false, // Default to true
      settings: node.settings || {},
        expire_time: (node.expireTime && node.expireTime !== 'unlimited') ? node.expireTime : null,
        expire_duration: node.expireDuration || null,
      created_at: new Date().toISOString()
      };

      console.log(`Workflow node ${index} prepared:`, workflowNode);
      workflowNodes.push(workflowNode);
    }

    console.log('All workflow nodes prepared:', workflowNodes);

    const { error: nodesError } = await supabase
      .from('cleansing_workflow_nodes')
      .insert(workflowNodes);

    if (nodesError) {
      console.error('Failed to insert workflow nodes:', nodesError);
      throw nodesError;
    }

    console.log('Workflow nodes inserted successfully');

    // Create node-specific CC assignments
    const allAssignments = [];
    for (let index = 0; index < processNodes.length; index++) {
      const node = processNodes[index];
      if (node.ccRecipients && node.ccRecipients.length > 0) {
        console.log(`Processing CC recipients for node ${node.id}:`, node.ccRecipients);
        
        for (const cc of node.ccRecipients) {
          const assignment = {
        cleansing_id: insertedCleansing.id,
        user_id: cc.id,
        user_name: cc.name,
        user_email: cc.email,
        role: 'cc',
            node_id: node.id,
            node_order: index,
        created_at: new Date().toISOString()
          };
          allAssignments.push(assignment);
          console.log(`CC assignment created:`, assignment);
        }
      }
    }

    if (allAssignments.length > 0) {
      console.log('Inserting CC assignments:', allAssignments);
      const { error: ccError } = await supabase
        .from('cleansing_assignments')
        .insert(allAssignments);

      if (ccError) {
        console.error('Failed to insert CC assignments:', ccError);
        throw ccError;
      }
      console.log('CC assignments inserted successfully');
    }

    // Send initial notifications with detailed logging
    console.log('Sending workflow notifications...');
    await sendWorkflowNotifications(insertedCleansing.id, 'created', supabase);
    console.log('Workflow notifications sent');

    console.log('=== CLEANSING CREATION SUCCESS ===');

    res.status(201).json({
      success: true,
      cleansing: insertedCleansing,
      message: 'Cleansing entry created successfully'
    });

  } catch (error) {
    console.error('=== CLEANSING CREATION ERROR ===');
    console.error('Error creating cleansing entry:', error);
    res.status(500).json({ 
      error: 'Failed to create cleansing entry',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/cleansing/list/:userId
 * @desc    Get cleansing entries for a user based on their role and active project
 * @access  Private
 */
router.get('/list/:userId', auth, disableRLS, async (req, res) => {
  try {
    const { userId } = req.params;
    const { projectId } = req.query;

    const supabase = req.supabaseAdmin || req.supabase;

    // Get user role
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role, name, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let cleansingQuery = supabase
      .from('cleansing_entries')
      .select(`
        *,
        cleansing_workflow_nodes(*),
        cleansing_assignments(*),
        cleansing_comments(*)
      `);

    // Filter by project if projectId is provided
    if (projectId) {
      cleansingQuery = cleansingQuery.eq('project_id', projectId);
    }

    // Filter based on user role
    if (user.role === 'admin') {
      // Admin can see all entries
      console.log('Admin user - showing all entries');
    } else {
      // For non-admin users, get their assignments first
      const { data: assignments, error: assignError } = await supabase
        .from('cleansing_assignments')
        .select('cleansing_id')
        .eq('user_id', userId);

      if (assignError) {
        console.error('Error fetching assignments:', assignError);
      }

      const assignedCleansingIds = assignments?.map(a => a.cleansing_id) || [];
      console.log(`User ${userId} is assigned to cleansing entries:`, assignedCleansingIds);

      // Build OR condition for entries user can see
      const conditions = [`created_by.eq.${userId}`];

      if (assignedCleansingIds.length > 0) {
        conditions.push(`id.in.(${assignedCleansingIds.join(',')})`);
      }

      // Also check if user is an executor in any workflow nodes
      const { data: executorNodes, error: executorError } = await supabase
        .from('cleansing_workflow_nodes')
        .select('cleansing_id')
        .eq('executor_id', userId);

      if (!executorError && executorNodes && executorNodes.length > 0) {
        const executorCleansingIds = executorNodes.map(n => n.cleansing_id);
        console.log(`User ${userId} is executor for cleansing entries:`, executorCleansingIds);
        if (executorCleansingIds.length > 0) {
          conditions.push(`id.in.(${executorCleansingIds.join(',')})`);
        }
      }

      if (conditions.length > 1) {
        cleansingQuery = cleansingQuery.or(conditions.join(','));
      } else {
        cleansingQuery = cleansingQuery.eq('created_by', userId);
      }

      console.log(`Applied filter conditions for user ${userId}:`, conditions);
    }

    const { data: cleansingEntries, error: cleansingError } = await cleansingQuery
      .order('created_at', { ascending: false });

    if (cleansingError) {
      console.error('Error fetching cleansing entries:', cleansingError);
      throw cleansingError;
    }

    console.log(`Returning ${cleansingEntries?.length || 0} cleansing entries for user ${userId}`);
    res.json(cleansingEntries || []);

  } catch (error) {
    console.error('Error fetching cleansing entries:', error);
    res.status(500).json({ 
      error: 'Failed to fetch cleansing entries',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/cleansing/:cleansingId
 * @desc    Get specific cleansing entry with workflow details
 * @access  Private
 */
router.get('/:cleansingId', auth, disableRLS, async (req, res) => {
  try {
    const { cleansingId } = req.params;
    const supabase = req.supabaseAdmin || req.supabase;

    const { data: cleansing, error: cleansingError } = await supabase
      .from('cleansing_entries')
      .select(`
        *,
        cleansing_workflow_nodes(*),
        cleansing_assignments(*),
        cleansing_comments(*)
      `)
      .eq('id', cleansingId)
      .single();

    if (cleansingError) throw cleansingError;

    if (!cleansing) {
      return res.status(404).json({ error: 'Cleansing entry not found' });
    }

    res.json(cleansing);

  } catch (error) {
    console.error('Error fetching cleansing entry:', error);
    res.status(500).json({ 
      error: 'Failed to fetch cleansing entry',
      details: error.message 
    });
  }
});

/**
 * @route   PUT /api/cleansing/:cleansingId/update
 * @desc    Update cleansing entry and advance workflow
 * @access  Private
 */
router.put('/:cleansingId/update', auth, disableRLS, async (req, res) => {
  try {
    const { cleansingId } = req.params;
    const { 
      formData, 
      action,
      comment,
      userId 
    } = req.body;

    const supabase = req.supabaseAdmin || req.supabase;

    // Get current cleansing entry
    const { data: cleansing, error: cleansingError } = await supabase
      .from('cleansing_entries')
      .select(`
        *,
        cleansing_workflow_nodes(*),
        cleansing_assignments(*)
      `)
      .eq('id', cleansingId)
      .single();

    if (cleansingError || !cleansing) {
      return res.status(404).json({ error: 'Cleansing entry not found' });
    }

    // Get user info
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role, name, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has permission to update
    const currentNode = cleansing.cleansing_workflow_nodes
      .find(node => node.node_order === cleansing.current_node_index);

    const canUpdate = user.role === 'admin' || 
                     cleansing.created_by === userId ||
                     cleansing.cleansing_assignments.some(a => a.user_id === userId) ||
                     (currentNode && currentNode.executor_id === userId);

    if (!canUpdate) {
      return res.status(403).json({ error: 'No permission to update this cleansing entry' });
    }

    // Check if current node has exceeded completion limit
    if (currentNode && currentNode.completion_count >= (currentNode.max_completions || 2) && !currentNode.can_re_edit) {
      return res.status(403).json({ 
        error: 'This node has reached its maximum completion limit and cannot be edited again',
        details: `Maximum ${currentNode.max_completions || 2} completions allowed`
      });
    }

    // Update form data if provided
    if (formData) {
      const { error: updateError } = await supabase
      .from('cleansing_entries')
        .update({
          form_data: formData,
          area: formData.areaInspected || cleansing.area,
          cleanliness_score: parseInt(formData.cleanlinessScore?.replace('%', '')) || cleansing.cleanliness_score,
          cleaning_status: formData.cleaningStatus || cleansing.cleaning_status,
          areas_cleaned: formData.areasRequiringCleaning || cleansing.areas_cleaned,
          waste_removed: formData.wasteRemovalRequired || cleansing.waste_removed,
          notes: formData.additionalNotes || cleansing.notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', cleansingId);

      if (updateError) throw updateError;
    }

    // Add comment if provided
    if (comment) {
      const { error: commentError } = await supabase
        .from('cleansing_comments')
        .insert([{
          cleansing_id: cleansingId,
          user_id: userId,
          user_name: user.name,
          comment: comment,
          action: action,
          created_at: new Date().toISOString()
        }]);

      if (commentError) throw commentError;
    }

    // Add workflow history entry
    if (action && currentNode) {
      const { error: historyError } = await supabase
        .from('cleansing_workflow_history')
        .insert([{
          cleansing_id: cleansingId,
          node_id: currentNode.node_id,
          node_order: currentNode.node_order,
          action: action,
          user_id: userId,
          user_name: user.name,
          comment: comment || '',
          created_at: new Date().toISOString()
        }]);

      if (historyError) {
        console.error('Failed to insert workflow history:', historyError);
      }
    }

    // Handle workflow actions
    if (action === 'approve' && currentNode) {
      // Update completion count and tracking
      const newCompletionCount = (currentNode.completion_count || 0) + 1;
      const canReEdit = newCompletionCount < (currentNode.max_completions || 2);

      // Mark current node as completed
      await supabase
          .from('cleansing_workflow_nodes')
          .update({
            status: 'completed',
          completed_by: userId,
            completed_at: new Date().toISOString(),
            completion_count: newCompletionCount,
            last_completed_at: new Date().toISOString(),
            can_re_edit: canReEdit
          })
        .eq('cleansing_id', cleansingId)
        .eq('node_order', cleansing.current_node_index);

      // Move to next node or complete
      const nextNodeIndex = cleansing.current_node_index + 1;
      const nextNode = cleansing.cleansing_workflow_nodes
        .find(node => node.node_order === nextNodeIndex);

      if (nextNode) {
        // Activate next node
        await supabase
          .from('cleansing_workflow_nodes')
          .update({ status: 'pending' })
          .eq('cleansing_id', cleansingId)
          .eq('node_order', nextNodeIndex);

        await supabase
          .from('cleansing_entries')
          .update({
            current_node_index: nextNodeIndex,
            current_active_node: nextNode.node_id
          })
          .eq('id', cleansingId);
      } else {
        // Complete the workflow
        await supabase
          .from('cleansing_entries')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            current_active_node: null
          })
          .eq('id', cleansingId);
      }

      // Send notifications
      await sendWorkflowNotifications(cleansingId, 'approved', supabase, comment);

    } else if (action === 'reject') {
      // Mark current node as rejected
      await supabase
        .from('cleansing_workflow_nodes')
        .update({
          status: 'rejected',
          completed_by: userId,
          completed_at: new Date().toISOString()
        })
        .eq('cleansing_id', cleansingId)
        .eq('node_order', cleansing.current_node_index);

      // Find the first node that can still be re-edited
      const firstEditableNode = cleansing.cleansing_workflow_nodes
        .filter(n => n.node_order >= 1)
        .sort((a, b) => a.node_order - b.node_order)
        .find(n => n.can_re_edit !== false && (n.completion_count || 0) < (n.max_completions || 2));

      if (!firstEditableNode) {
        // No nodes can be re-edited, mark as permanently rejected
        await supabase
          .from('cleansing_entries')
          .update({
            status: 'permanently_rejected',
            current_node_index: null,
            current_active_node: null
          })
          .eq('id', cleansingId);

        return res.json({
          success: true,
          message: 'Cleansing entry permanently rejected - no more edits allowed',
          permanently_rejected: true
        });
      }

      // Send back to first editable node
      await supabase
        .from('cleansing_entries')
        .update({
          status: 'rejected',
          current_node_index: firstEditableNode.node_order,
          current_active_node: firstEditableNode.node_id
        })
        .eq('id', cleansingId);

      // Reset all nodes after the target node to waiting
      await supabase
        .from('cleansing_workflow_nodes')
        .update({ status: 'waiting' })
        .eq('cleansing_id', cleansingId)
        .gt('node_order', firstEditableNode.node_order);

      // Reactivate target node
      await supabase
        .from('cleansing_workflow_nodes')
        .update({ status: 'pending' })
        .eq('cleansing_id', cleansingId)
        .eq('node_order', firstEditableNode.node_order);

      // Send rejection notifications
      await sendWorkflowNotifications(cleansingId, 'rejected', supabase, comment);

    } else if (action === 'back') {
      // Find the previous node that can still be re-edited
      const prevEditableNode = cleansing.cleansing_workflow_nodes
        .filter(n => n.node_order < cleansing.current_node_index && n.node_order >= 1)
        .sort((a, b) => b.node_order - a.node_order) // Sort descending to get the closest previous node
        .find(n => n.can_re_edit !== false && (n.completion_count || 0) < (n.max_completions || 2));

      if (!prevEditableNode) {
        return res.status(400).json({ 
          error: 'No previous node available for editing',
          details: 'All previous nodes have reached their completion limit'
        });
      }
      
      // Mark current node as sent back
      await supabase
        .from('cleansing_workflow_nodes')
        .update({
          status: 'sent_back',
          completed_by: userId,
          completed_at: new Date().toISOString()
        })
        .eq('cleansing_id', cleansingId)
        .eq('node_order', cleansing.current_node_index);

      // Activate previous editable node
      await supabase
        .from('cleansing_workflow_nodes')
        .update({ status: 'pending' })
        .eq('cleansing_id', cleansingId)
        .eq('node_order', prevEditableNode.node_order);

      await supabase
        .from('cleansing_entries')
        .update({ 
          current_node_index: prevEditableNode.node_order,
          current_active_node: prevEditableNode.node_id
        })
        .eq('id', cleansingId);

      // Send back notifications
      await sendWorkflowNotifications(cleansingId, 'sent_back', supabase, comment);
    }

    res.json({
      success: true,
      message: 'Cleansing entry updated successfully'
    });

  } catch (error) {
    console.error('Error updating cleansing entry:', error);
    res.status(500).json({ 
      error: 'Failed to update cleansing entry',
      details: error.message 
    });
  }
});

/**
 * @route   DELETE /api/cleansing/:id
 * @desc    Delete a cleansing entry (admin only)
 * @access  Private/Admin
 */
router.delete('/:id', auth, disableRLS, async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = req.supabaseAdmin || req.supabase;

    // Get user info to verify admin role
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admin users can delete cleansing entries' });
    }

    // Check if cleansing entry exists
    const { data: cleansing, error: cleansingError } = await supabase
      .from('cleansing_entries')
      .select('id')
      .eq('id', id)
      .single();

    if (cleansingError || !cleansing) {
      return res.status(404).json({ error: 'Cleansing entry not found' });
    }

    // Delete related workflow nodes first
    await supabase
      .from('cleansing_workflow_nodes')
      .delete()
      .eq('cleansing_id', id);

    // Delete related assignments
    await supabase
      .from('cleansing_assignments')
      .delete()
      .eq('cleansing_id', id);

    // Delete related comments
    await supabase
      .from('cleansing_comments')
      .delete()
      .eq('cleansing_id', id);

    // Delete the cleansing entry
    const { error: deleteError } = await supabase
      .from('cleansing_entries')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting cleansing entry:', deleteError);
      return res.status(500).json({ error: 'Failed to delete cleansing entry' });
    }

    res.json({ message: 'Cleansing entry deleted successfully' });

  } catch (error) {
    console.error('Error in delete cleansing route:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Send workflow notifications via email
 */
async function sendWorkflowNotifications(cleansingId, action, supabase, comment = '') {
  try {
    console.log(`=== SENDING CLEANSING NOTIFICATIONS FOR ${action.toUpperCase()} ===`);
    console.log(`Cleansing ID: ${cleansingId}`);

    // Get cleansing entry with all related data
    const { data: cleansing, error } = await supabase
      .from('cleansing_entries')
      .select(`
        *,
        cleansing_workflow_nodes(*),
        cleansing_assignments(*)
      `)
      .eq('id', cleansingId)
      .single();

    if (error || !cleansing) {
      console.error('Failed to fetch cleansing for notifications:', error);
      return;
    }

    console.log('Cleansing data for notifications:', JSON.stringify(cleansing, null, 2));

    // Get current node
    const currentNode = cleansing.cleansing_workflow_nodes
      .find(node => node.node_order === cleansing.current_node_index);

    console.log('Current node:', currentNode);

    // Collect all recipients with proper deduplication
    let recipients = new Map(); // Use Map to avoid duplicates by user ID

    if (action === 'created') {
      console.log('Processing CREATED action notifications...');
      
      // Notify executor of first node
      if (currentNode && currentNode.executor_id) {
        console.log(`Looking up executor for current node: ${currentNode.executor_id}`);
        const { data: executor, error: executorError } = await supabase
          .from('users')
          .select('*')
          .eq('id', currentNode.executor_id)
          .single();
        
        if (executorError) {
          console.error('Failed to fetch executor:', executorError);
        } else if (executor) {
          recipients.set(executor.id, {
            ...executor,
            role_in_workflow: 'executor',
            node_name: currentNode.node_name
          });
          console.log(`Added executor to recipients:`, executor);
        }
      } else {
        console.log('No executor found for current node');
      }

      // Add CCs for current node only
      const currentNodeCCs = cleansing.cleansing_assignments.filter(assignment => 
        assignment.node_id === currentNode?.node_id
      );
      
      console.log(`Found ${currentNodeCCs.length} CC recipients for current node:`, currentNodeCCs);
      
      for (const assignment of currentNodeCCs) {
        if (!recipients.has(assignment.user_id)) {
          recipients.set(assignment.user_id, {
            id: assignment.user_id,
            name: assignment.user_name,
          email: assignment.user_email,
            role_in_workflow: 'cc',
            node_name: currentNode?.node_name
          });
          console.log(`Added CC to recipients:`, assignment);
        }
      }

    } else if (action === 'approved') {
      console.log('Processing APPROVED action notifications...');
      
      // Notify next executor if exists
      const nextNode = cleansing.cleansing_workflow_nodes
        .find(node => node.node_order === cleansing.current_node_index);

      console.log('Next node for approval:', nextNode);

      if (nextNode && nextNode.executor_id) {
        const { data: executor, error: executorError } = await supabase
          .from('users')
          .select('*')
          .eq('id', nextNode.executor_id)
          .single();
        
        if (executorError) {
          console.error('Failed to fetch next executor:', executorError);
        } else if (executor) {
          recipients.set(executor.id, {
            ...executor,
            role_in_workflow: 'executor',
            node_name: nextNode.node_name
          });
          console.log(`Added next executor to recipients:`, executor);
        }
      }

      // Add CCs for next node
      const nextNodeCCs = cleansing.cleansing_assignments.filter(assignment => 
        assignment.node_id === nextNode?.node_id
      );
      
      console.log(`Found ${nextNodeCCs.length} CC recipients for next node:`, nextNodeCCs);
      
      for (const assignment of nextNodeCCs) {
        if (!recipients.has(assignment.user_id)) {
          recipients.set(assignment.user_id, {
            id: assignment.user_id,
            name: assignment.user_name,
            email: assignment.user_email,
            role_in_workflow: 'cc',
            node_name: nextNode?.node_name
          });
          console.log(`Added next node CC to recipients:`, assignment);
        }
      }

    } else if (action === 'rejected' || action === 'sent_back') {
      console.log(`Processing ${action.toUpperCase()} action notifications...`);
      
      // Notify the target node executor (admin for reject, previous executor for back)
      const targetNode = cleansing.cleansing_workflow_nodes
        .find(node => node.node_order === cleansing.current_node_index);

      console.log('Target node:', targetNode);

      if (targetNode) {
        if (action === 'rejected') {
          // For rejection, notify admin (creator)
          const { data: creator, error: creatorError } = await supabase
            .from('users')
            .select('*')
            .eq('id', cleansing.created_by)
            .single();

          if (creatorError) {
            console.error('Failed to fetch creator:', creatorError);
          } else if (creator) {
            recipients.set(creator.id, {
              ...creator,
              role_in_workflow: 'admin',
              node_name: 'Admin Review'
            });
            console.log(`Added creator to recipients:`, creator);
          }
        } else if (action === 'sent_back' && targetNode.executor_id) {
          // For send back, notify previous executor
          const { data: executor, error: executorError } = await supabase
        .from('users')
            .select('*')
            .eq('id', targetNode.executor_id)
        .single();
          
          if (executorError) {
            console.error('Failed to fetch target executor:', executorError);
          } else if (executor) {
            recipients.set(executor.id, {
              ...executor,
              role_in_workflow: 'executor',
              node_name: targetNode.node_name
            });
            console.log(`Added target executor to recipients:`, executor);
          }
        }
      }

      // Add CCs for target node
      const targetNodeCCs = cleansing.cleansing_assignments.filter(assignment => 
        assignment.node_id === targetNode?.node_id
      );
      
      console.log(`Found ${targetNodeCCs.length} CC recipients for target node:`, targetNodeCCs);
      
      for (const assignment of targetNodeCCs) {
        if (!recipients.has(assignment.user_id)) {
          recipients.set(assignment.user_id, {
            id: assignment.user_id,
            name: assignment.user_name,
            email: assignment.user_email,
            role_in_workflow: 'cc',
            node_name: targetNode?.node_name
          });
          console.log(`Added target node CC to recipients:`, assignment);
        }
      }
    }

    // Convert Map to Array and send consolidated email
    const uniqueRecipients = Array.from(recipients.values());
    
    console.log(`Total unique recipients: ${uniqueRecipients.length}`);
    console.log('All recipients:', uniqueRecipients.map(r => ({ name: r.name, email: r.email, role: r.role_in_workflow })));
    
    if (uniqueRecipients.length > 0) {
      // Send email notifications
      await sendConsolidatedCleansingEmail(uniqueRecipients, cleansing, action, comment);
      
      // Create in-app notifications
      try {
        console.log('Creating in-app notifications for cleansing...');
        
        // Get executor IDs and CC IDs
        const executorIds = uniqueRecipients
          .filter(r => r.role_in_workflow === 'executor' || r.role_in_workflow === 'admin')
          .map(r => r.id);
        
        const ccUserIds = uniqueRecipients
          .filter(r => r.role_in_workflow === 'cc')
          .map(r => r.id);
        
        // Create notifications for each executor
        for (const executorId of executorIds) {
          await createFormAssignmentNotifications(supabase, {
            formType: 'cleansing',
            formId: cleansing.id,
            projectId: cleansing.project_id,
            projectName: cleansing.project,
            action,
            executorId,
            ccUserIds: [], // Don't duplicate CCs here
            comment
          });
        }
        
        // Create notifications for CC users
        for (const ccUserId of ccUserIds) {
          await createFormAssignmentNotifications(supabase, {
            formType: 'cleansing',
            formId: cleansing.id,
            projectId: cleansing.project_id,
            projectName: cleansing.project,
            action,
            executorId: null,
            ccUserIds: [ccUserId],
            comment
          });
        }
        
        console.log('In-app notifications created successfully for cleansing');
      } catch (notificationError) {
        console.error('Error creating in-app notifications for cleansing:', notificationError);
        // Don't fail the whole process if notifications fail
      }
    } else {
      console.log('No recipients found for cleansing notifications');
    }

    console.log('=== CLEANSING NOTIFICATIONS PROCESSING COMPLETE ===');

  } catch (error) {
    console.error('=== CLEANSING NOTIFICATION ERROR ===');
    console.error('Error sending workflow notifications:', error);
  }
}

/**
 * Send consolidated cleansing email to all recipients
 */
async function sendConsolidatedCleansingEmail(recipients, cleansing, action, comment = '') {
  try {
    console.log(`=== SENDING CLEANSING EMAIL FOR ${action.toUpperCase()} ===`);
    console.log(`Recipients count: ${recipients.length}`);
    
    let subject = '';
    let message = '';
    const viewUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/cleansing`;

    // Separate executors and CCs for personalized messaging
    const executors = recipients.filter(r => r.role_in_workflow === 'executor' || r.role_in_workflow === 'admin');
    const ccs = recipients.filter(r => r.role_in_workflow === 'cc');

    console.log(`Executors: ${executors.length}, CCs: ${ccs.length}`);
    console.log('Executor emails:', executors.map(e => e.email));
    console.log('CC emails:', ccs.map(c => c.email));

    switch (action) {
      case 'created':
        subject = `New Cleansing Record: ${cleansing.project} - Action Required`;
        message = `
Dear Team,

A new cleansing record has been created for project "${cleansing.project}" and requires attention.

Project: ${cleansing.project}
Date: ${cleansing.date}
Inspector: ${cleansing.inspector}
Area: ${cleansing.area}
Cleanliness Score: ${cleansing.cleanliness_score}%
Entry ID: ${cleansing.id}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and approve for "${e.node_name}"`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): You are CC'd on this cleansing record for "${c.node_name}"`).join('\n')}
` : ''}

Please log in to MatrixTwin to view and take action: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'approved':
        subject = `Cleansing Record Approved: ${cleansing.project} - Next Action Required`;
        message = `
Dear Team,

A cleansing record for project "${cleansing.project}" has been approved and moved to the next workflow step.

Project: ${cleansing.project}
Date: ${cleansing.date}
Entry ID: ${cleansing.id}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and approve for "${e.node_name}"`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): Cleansing record has progressed to "${c.node_name}"`).join('\n')}
` : ''}

Please log in to MatrixTwin to view and take action: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'rejected':
        subject = `Cleansing Record Rejected: ${cleansing.project} - Admin Action Required`;
        message = `
Dear Team,

A cleansing record for project "${cleansing.project}" has been rejected and requires admin attention.

Project: ${cleansing.project}
Date: ${cleansing.date}
Entry ID: ${cleansing.id}

${comment ? `Rejection Reason: ${comment}` : ''}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and resolve the issues`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): Cleansing record has been rejected and needs revision`).join('\n')}
` : ''}

Please log in to MatrixTwin to review and resolve: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'sent_back':
        subject = `Cleansing Record Sent Back: ${cleansing.project} - Review Required`;
        message = `
Dear Team,

A cleansing record for project "${cleansing.project}" has been sent back for review.

Project: ${cleansing.project}
Date: ${cleansing.date}
Entry ID: ${cleansing.id}

${comment ? `Comments: ${comment}` : ''}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review the comments and take action for "${e.node_name}"`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): Cleansing record has been sent back for review`).join('\n')}
` : ''}

Please log in to MatrixTwin to review and take action: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;
    }

    // Send to all recipients in one email
    const allEmails = recipients.map(r => r.email);

    console.log('Email subject:', subject);
    console.log('Email recipients:', allEmails);
    console.log('Email message preview:', message.substring(0, 200) + '...');

    const emailResult = await resend.emails.send({
      from: 'MatrixTwin <noreply@matrixtwin.com>',
      to: allEmails,
      subject: subject,
      text: message,
      html: message.replace(/\n/g, '<br>')
    });

    console.log('Email send result:', emailResult);
    console.log(`Consolidated email sent successfully to ${allEmails.length} recipients for cleansing ${cleansing.id}`);

  } catch (error) {
    console.error('=== CLEANSING EMAIL SENDING ERROR ===');
    console.error('Error sending consolidated cleansing email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
  }
}

module.exports = router; 