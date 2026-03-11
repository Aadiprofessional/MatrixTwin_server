const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { createFormAssignmentNotifications, createNotification } = require('./notifications');
const { sendEmail } = require('../utils/email');

// Middleware to temporarily disable RLS for safety operations
const disableRLS = async (req, res, next) => {
  try {
    // Create a new supabase client with service role key for bypassing RLS
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl) {
      throw new Error('Missing Supabase URL');
    }

    const keyToUse = serviceKey || anonKey;

    if (!keyToUse) {
      throw new Error('Missing Supabase key (Service Role or Anon)');
    }

    if (!serviceKey) {
      console.warn('SUPABASE_SERVICE_ROLE_KEY not found. Using Anon key. RLS bypass may not work.');
    }
    
    req.supabaseAdmin = createClient(supabaseUrl, keyToUse, {
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

const DEFAULT_EXPIRY_DAYS = 10;
const getDefaultExpiryDate = () => {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + DEFAULT_EXPIRY_DAYS);
  return expiry.toISOString();
};

const isTerminalStatus = (status) => ['completed', 'permanently_rejected', 'expired'].includes(status);

async function autoExpireSafetyEntries(supabase) {
  const now = new Date().toISOString();
  await supabase
    .from('safety_entries')
    .update({
      status: 'expired',
      expired_at: now
    })
    .lte('expires_at', now)
    .not('expires_at', 'is', null)
    .neq('status', 'expired')
    .neq('status', 'completed')
    .neq('status', 'permanently_rejected');
}

/**
 * @route   POST /api/safety/create
 * @desc    Create a new safety entry with workflow
 * @access  Private/Admin
 */
router.post('/create', auth, disableRLS, async (req, res) => {
  try {
    const { 
      formData, 
      processNodes, 
      createdBy,
      projectId,
      formId,
      name
    } = req.body;

    console.log('=== SAFETY CREATION START ===');
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
      console.error('Non-admin user attempted to create safety entry:', user);
      return res.status(403).json({ error: 'Only admins can create safety entries' });
    }

    // Create safety entry
    const safetyEntry = {
      id: formId || `safety_${Date.now()}`,
      date: formData.inspectionDate || new Date().toISOString().split('T')[0],
      project: projectId || formData.projectId || 'Unknown Project',
      project_id: projectId,
      inspector: user.name,
      inspection_type: formData.inspectionType || 'General Safety Inspection',
      safety_score: parseInt(formData.overallSafetyScore?.replace('%', '')) || 0,
      findings_count: formData.nonComplianceDetails ? 1 : 0,
      incidents_reported: formData.nonComplianceDetails || '',
      corrective_actions: formData.recommendedActions || '',
      notes: formData.immediateActions || '',
      form_data: {
        ...formData,
        name: name || formData.name || formData.formNumber // Ensure name is saved
      },
      created_by: createdBy,
      created_at: new Date().toISOString(),
      expires_at: getDefaultExpiryDate(),
      status: 'pending',
      current_node_index: 1,
      current_active_node: processNodes.find(n => n.type === 'node')?.id || null
    };

    console.log('Safety entry to insert:', safetyEntry);

    // Insert safety entry
    const { data: insertedSafety, error: safetyError } = await supabase
      .from('safety_entries')
      .insert([safetyEntry])
      .select()
      .single();

    if (safetyError) {
      console.error('Failed to insert safety entry:', safetyError);
      throw safetyError;
    }

    console.log('Safety entry inserted successfully:', insertedSafety);

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
      safety_id: insertedSafety.id,
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
      .from('safety_workflow_nodes')
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
        safety_id: insertedSafety.id,
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
        .from('safety_assignments')
        .insert(allAssignments);

      if (ccError) {
        console.error('Failed to insert CC assignments:', ccError);
        throw ccError;
      }
      console.log('CC assignments inserted successfully');
    }

    // Send initial notifications with detailed logging
    console.log('Sending workflow notifications...');
    await sendWorkflowNotifications(insertedSafety.id, 'created', supabase);
    console.log('Workflow notifications sent');

    console.log('=== SAFETY CREATION SUCCESS ===');

    res.status(201).json({
      success: true,
      safety: insertedSafety,
      message: 'Safety entry created successfully'
    });

  } catch (error) {
    console.error('=== SAFETY CREATION ERROR ===');
    console.error('Error creating safety entry:', error);
    res.status(500).json({ 
      error: 'Failed to create safety entry',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/safety/list/:userId
 * @desc    Get safety entries for a user based on their role and active project
 * @access  Private
 */
router.get('/list/:userId', auth, disableRLS, async (req, res) => {
  try {
    const { userId } = req.params;
    const { projectId } = req.query;

    const supabase = req.supabaseAdmin || req.supabase;
    await autoExpireSafetyEntries(supabase);

    // Get user role
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role, name, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let safetyQuery = supabase
      .from('safety_entries')
      .select(`
        *,
        safety_workflow_nodes(*),
        safety_assignments(*),
        safety_comments(*)
      `);

    // Filter by project if projectId is provided
    if (projectId) {
      safetyQuery = safetyQuery.eq('project_id', projectId);
    }

    // Filter based on user role
    if (user.role === 'admin') {
      // Admin can see all entries
      console.log('Admin user - showing all entries');
    } else {
      // For non-admin users, get their assignments first
      const { data: assignments, error: assignError } = await supabase
        .from('safety_assignments')
        .select('safety_id')
        .eq('user_id', userId);

      if (assignError) {
        console.error('Error fetching assignments:', assignError);
      }

      const assignedSafetyIds = assignments?.map(a => a.safety_id) || [];
      console.log(`User ${userId} is assigned to safety entries:`, assignedSafetyIds);

      // Build OR condition for entries user can see
      const conditions = [`created_by.eq.${userId}`];

      if (assignedSafetyIds.length > 0) {
        conditions.push(`id.in.(${assignedSafetyIds.join(',')})`);
      }

      // Also check if user is an executor in any workflow nodes
      const { data: executorNodes, error: executorError } = await supabase
        .from('safety_workflow_nodes')
        .select('safety_id')
        .eq('executor_id', userId);

      if (!executorError && executorNodes && executorNodes.length > 0) {
        const executorSafetyIds = executorNodes.map(n => n.safety_id);
        console.log(`User ${userId} is executor for safety entries:`, executorSafetyIds);
        if (executorSafetyIds.length > 0) {
          conditions.push(`id.in.(${executorSafetyIds.join(',')})`);
        }
      }

      if (conditions.length > 1) {
        safetyQuery = safetyQuery.or(conditions.join(','));
      } else {
        safetyQuery = safetyQuery.eq('created_by', userId);
      }

      console.log(`Applied filter conditions for user ${userId}:`, conditions);
    }

    const { data: safetyEntries, error: safetyError } = await safetyQuery
      .order('created_at', { ascending: false });

    if (safetyError) {
      console.error('Error fetching safety entries:', safetyError);
      throw safetyError;
    }

    console.log(`Returning ${safetyEntries?.length || 0} safety entries for user ${userId}`);
    res.json(safetyEntries || []);

  } catch (error) {
    console.error('Error fetching safety entries:', error);
    res.status(500).json({ 
      error: 'Failed to fetch safety entries',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/safety/:safetyId
 * @desc    Get specific safety entry with workflow details
 * @access  Private
 */
router.get('/:safetyId', auth, disableRLS, async (req, res) => {
  try {
    const { safetyId } = req.params;
    const supabase = req.supabaseAdmin || req.supabase;
    await autoExpireSafetyEntries(supabase);

    const { data: safety, error: safetyError } = await supabase
      .from('safety_entries')
      .select(`
        *,
        safety_workflow_nodes(*),
        safety_assignments(*),
        safety_comments(*)
      `)
      .eq('id', safetyId)
      .single();

    if (safetyError) throw safetyError;

    if (!safety) {
      return res.status(404).json({ error: 'Safety entry not found' });
    }

    res.json(safety);

  } catch (error) {
    console.error('Error fetching safety entry:', error);
    res.status(500).json({ 
      error: 'Failed to fetch safety entry',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/safety/:safetyId/history
 * @desc    Get history of changes for a safety entry
 * @access  Private
 */
router.get('/:safetyId/history', auth, disableRLS, async (req, res) => {
  try {
    const { safetyId } = req.params;
    const supabase = req.supabaseAdmin || req.supabase;

    const { data: history, error: historyError } = await supabase
      .from('safety_entry_history')
      .select(`
        *,
        users:changed_by (name, email)
      `)
      .eq('safety_id', safetyId)
      .order('changed_at', { ascending: false });

    if (historyError) throw historyError;

    res.json(history);
  } catch (error) {
    console.error('Error fetching safety history:', error);
    res.status(500).json({ 
      error: 'Failed to fetch safety history',
      details: error.message 
    });
  }
});

/**
 * @route   PUT /api/safety/:safetyId/update
 * @desc    Update safety entry and advance workflow
 * @access  Private
 */
router.put('/:safetyId/update', auth, disableRLS, async (req, res) => {
  try {
    const { safetyId } = req.params;
    const { 
      formData, 
      action,
      comment,
      userId 
    } = req.body;

    const supabase = req.supabaseAdmin || req.supabase;
    await autoExpireSafetyEntries(supabase);

    // Get current safety entry
    const { data: safety, error: safetyError } = await supabase
      .from('safety_entries')
      .select(`
        *,
        safety_workflow_nodes(*),
        safety_assignments(*)
      `)
      .eq('id', safetyId)
      .single();

    if (safetyError || !safety) {
      return res.status(404).json({ error: 'Safety entry not found' });
    }

    if (safety.expires_at && new Date(safety.expires_at) <= new Date() && !isTerminalStatus(safety.status)) {
      await supabase
        .from('safety_entries')
        .update({
          status: 'expired',
          expired_at: new Date().toISOString()
        })
        .eq('id', safetyId);

      return res.status(400).json({ error: 'Safety entry has expired' });
    }

    if (safety.status === 'expired') {
      return res.status(400).json({ error: 'Safety entry has expired' });
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
    const currentNode = safety.safety_workflow_nodes
      .find(node => node.node_order === safety.current_node_index);

    const canUpdate = user.role === 'admin' || 
                     safety.created_by === userId ||
                     safety.safety_assignments.some(a => a.user_id === userId) ||
                     (currentNode && currentNode.executor_id === userId);

    if (!canUpdate) {
      return res.status(403).json({ error: 'No permission to update this safety entry' });
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
      // Create history entry
      const historyEntry = {
        safety_id: safetyId,
        changed_by: userId,
        changed_at: new Date().toISOString(),
        form_data: formData,
        change_reason: action || 'update',
        node_order: currentNode ? currentNode.node_order : null
      };

      const { error: historyError } = await supabase
        .from('safety_entry_history')
        .insert([historyEntry]);

      if (historyError) {
        console.error('Failed to save safety history:', historyError);
        // Continue with update even if history fails, but log it
      }

      const { error: updateError } = await supabase
      .from('safety_entries')
        .update({
          form_data: formData,
          safety_score: parseInt(formData.overallSafetyScore?.replace('%', '')) || safety.safety_score,
          incidents_reported: formData.nonComplianceDetails || safety.incidents_reported,
          corrective_actions: formData.recommendedActions || safety.corrective_actions,
          notes: formData.immediateActions || safety.notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', safetyId);

      if (updateError) throw updateError;
    }

    // Add comment if provided
    if (comment) {
      const { error: commentError } = await supabase
        .from('safety_comments')
        .insert([{
          safety_id: safetyId,
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
        .from('safety_workflow_history')
        .insert([{
          safety_id: safetyId,
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
          .from('safety_workflow_nodes')
          .update({
            status: 'completed',
          completed_by: userId,
            completed_at: new Date().toISOString(),
            completion_count: newCompletionCount,
            last_completed_at: new Date().toISOString(),
            can_re_edit: canReEdit
          })
        .eq('safety_id', safetyId)
        .eq('node_order', safety.current_node_index);

      // Move to next node or complete
      const nextNodeIndex = safety.current_node_index + 1;
      const nextNode = safety.safety_workflow_nodes
        .find(node => node.node_order === nextNodeIndex);

      if (nextNode) {
        // Activate next node
        await supabase
          .from('safety_workflow_nodes')
          .update({ status: 'pending' })
          .eq('safety_id', safetyId)
          .eq('node_order', nextNodeIndex);

        await supabase
          .from('safety_entries')
          .update({
            current_node_index: nextNodeIndex,
            current_active_node: nextNode.node_id
          })
          .eq('id', safetyId);
      } else {
        // Complete the workflow
        await supabase
          .from('safety_entries')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            current_active_node: null
          })
          .eq('id', safetyId);
      }

      // Send notifications
      await sendWorkflowNotifications(safetyId, 'approved', supabase, comment);

    } else if (action === 'reject') {
      // Mark current node as rejected
      await supabase
        .from('safety_workflow_nodes')
        .update({
          status: 'rejected',
          completed_by: userId,
          completed_at: new Date().toISOString()
        })
        .eq('safety_id', safetyId)
        .eq('node_order', safety.current_node_index);

      // Find the first node that can still be re-edited
      const firstEditableNode = safety.safety_workflow_nodes
        .filter(n => n.node_order >= 1)
        .sort((a, b) => a.node_order - b.node_order)
        .find(n => n.can_re_edit !== false && (n.completion_count || 0) < (n.max_completions || 2));

      if (!firstEditableNode) {
        // No nodes can be re-edited, mark as permanently rejected
        await supabase
          .from('safety_entries')
          .update({
            status: 'permanently_rejected',
            current_node_index: null,
            current_active_node: null
          })
          .eq('id', safetyId);

        return res.json({
          success: true,
          message: 'Safety entry permanently rejected - no more edits allowed',
          permanently_rejected: true
        });
      }

      // REVERT LOGIC: Restore form data from history for the target node
      const { data: revertHistory } = await supabase
        .from('safety_entry_history')
        .select('form_data')
        .eq('safety_id', safetyId)
        .eq('node_order', firstEditableNode.node_order)
        .order('changed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (revertHistory && revertHistory.form_data) {
        console.log(`Reverting safety ${safetyId} to data from node ${firstEditableNode.node_order}`);
        
        await supabase
          .from('safety_entries')
          .update({
            form_data: revertHistory.form_data,
            updated_at: new Date().toISOString()
          })
          .eq('id', safetyId);

        // Record this revert in history
        await supabase
          .from('safety_entry_history')
          .insert([{
            safety_id: safetyId,
            changed_by: userId,
            changed_at: new Date().toISOString(),
            form_data: revertHistory.form_data,
            change_reason: `revert_to_node_${firstEditableNode.node_order}`,
            node_order: firstEditableNode.node_order
          }]);
      }

      // Send back to first editable node
      await supabase
        .from('safety_entries')
        .update({
          status: 'rejected',
          current_node_index: firstEditableNode.node_order,
          current_active_node: firstEditableNode.node_id
        })
        .eq('id', safetyId);

      // Reset all nodes after the target node to waiting
      await supabase
        .from('safety_workflow_nodes')
        .update({ status: 'waiting' })
        .eq('safety_id', safetyId)
        .gt('node_order', firstEditableNode.node_order);

      // Reactivate target node
      await supabase
        .from('safety_workflow_nodes')
        .update({ status: 'pending' })
        .eq('safety_id', safetyId)
        .eq('node_order', firstEditableNode.node_order);

      // Send rejection notifications
      await sendWorkflowNotifications(safetyId, 'rejected', supabase, comment);

    } else if (action === 'back') {
      // Find the previous node that can still be re-edited
      const prevEditableNode = safety.safety_workflow_nodes
        .filter(n => n.node_order < safety.current_node_index && n.node_order >= 1)
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
        .from('safety_workflow_nodes')
        .update({
          status: 'sent_back',
          completed_by: userId,
          completed_at: new Date().toISOString()
        })
        .eq('safety_id', safetyId)
        .eq('node_order', safety.current_node_index);

      // Activate previous editable node
      await supabase
        .from('safety_workflow_nodes')
        .update({ status: 'pending' })
        .eq('safety_id', safetyId)
        .eq('node_order', prevEditableNode.node_order);

      // REVERT LOGIC: Restore form data from history for the target node (prevEditableNode)
      const { data: revertHistory } = await supabase
        .from('safety_entry_history')
        .select('form_data')
        .eq('safety_id', safetyId)
        .eq('node_order', prevEditableNode.node_order)
        .order('changed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (revertHistory && revertHistory.form_data) {
        console.log(`Reverting safety ${safetyId} to data from node ${prevEditableNode.node_order}`);
        
        await supabase
          .from('safety_entries')
          .update({
            form_data: revertHistory.form_data,
            updated_at: new Date().toISOString()
          })
          .eq('id', safetyId);

        // Record this revert in history
        await supabase
          .from('safety_entry_history')
          .insert([{
            safety_id: safetyId,
            changed_by: userId,
            changed_at: new Date().toISOString(),
            form_data: revertHistory.form_data,
            change_reason: `back_to_node_${prevEditableNode.node_order}`,
            node_order: prevEditableNode.node_order
          }]);
      }

      // Move back to previous node
      await supabase
        .from('safety_entries')
        .update({ 
          current_node_index: prevEditableNode.node_order,
          current_active_node: prevEditableNode.node_id
        })
        .eq('id', safetyId);

      // Send back notifications
      await sendWorkflowNotifications(safetyId, 'sent_back', supabase, comment);
    }

    res.json({
      success: true,
      message: 'Safety entry updated successfully'
    });

  } catch (error) {
    console.error('Error updating safety entry:', error);
    res.status(500).json({ 
      error: 'Failed to update safety entry',
      details: error.message 
    });
  }
});

router.patch('/:safetyId/expiry', auth, disableRLS, async (req, res) => {
  try {
    const { safetyId } = req.params;
    const { userId, expiresAt } = req.body;
    const supabase = req.supabaseAdmin || req.supabase;

    if (!expiresAt) {
      return res.status(400).json({ error: 'expiresAt is required' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can set expiry date' });
    }

    const expiryDate = new Date(expiresAt);
    if (Number.isNaN(expiryDate.getTime())) {
      return res.status(400).json({ error: 'Invalid expiresAt value' });
    }

    const { data: updatedSafety, error: updateError } = await supabase
      .from('safety_entries')
      .update({
        expires_at: expiryDate.toISOString(),
        status: expiryDate > new Date() ? 'pending' : 'expired',
        expired_at: expiryDate > new Date() ? null : new Date().toISOString()
      })
      .eq('id', safetyId)
      .select()
      .single();

    if (updateError || !updatedSafety) {
      return res.status(404).json({ error: 'Safety entry not found' });
    }

    res.json({
      success: true,
      message: 'Safety expiry date updated successfully',
      data: updatedSafety
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update expiry date', details: error.message });
  }
});

router.patch('/:safetyId/expiry-status', auth, disableRLS, async (req, res) => {
  try {
    const { safetyId } = req.params;
    const { userId, active } = req.body;
    const supabase = req.supabaseAdmin || req.supabase;

    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can change expiry status' });
    }

    const updatePayload = active
      ? { status: 'pending', expired_at: null }
      : { status: 'expired', expired_at: new Date().toISOString() };

    const { data: updatedSafety, error: updateError } = await supabase
      .from('safety_entries')
      .update(updatePayload)
      .eq('id', safetyId)
      .select()
      .single();

    if (updateError || !updatedSafety) {
      return res.status(404).json({ error: 'Safety entry not found' });
    }

    res.json({
      success: true,
      message: active ? 'Safety entry reactivated successfully' : 'Safety entry marked as expired',
      data: updatedSafety
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update safety status', details: error.message });
  }
});

router.patch('/:safetyId/name', auth, disableRLS, async (req, res) => {
  try {
    const { safetyId } = req.params;
    const { userId, name } = req.body;
    const supabase = req.supabaseAdmin || req.supabase;

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return res.status(400).json({ error: 'name is required' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update form name' });
    }

    const { data: safety, error: safetyError } = await supabase
      .from('safety_entries')
      .select('id, form_data')
      .eq('id', safetyId)
      .single();

    if (safetyError || !safety) {
      return res.status(404).json({ error: 'Safety entry not found' });
    }

    const { data: updatedSafety, error: updateError } = await supabase
      .from('safety_entries')
      .update({
        form_data: {
          ...(safety.form_data || {}),
          name: trimmedName
        }
      })
      .eq('id', safetyId)
      .select()
      .single();

    if (updateError || !updatedSafety) {
      return res.status(500).json({ error: 'Failed to update safety name' });
    }

    res.json({
      success: true,
      message: 'Safety name updated successfully',
      data: updatedSafety
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update safety name', details: error.message });
  }
});

router.post('/:safetyId/nodes/:nodeOrder/delay-notify', auth, disableRLS, async (req, res) => {
  try {
    const { safetyId, nodeOrder } = req.params;
    const { userId, message } = req.body;
    const supabase = req.supabaseAdmin || req.supabase;

    const { data: safety, error: safetyError } = await supabase
      .from('safety_entries')
      .select(`
        *,
        safety_workflow_nodes(*),
        safety_assignments(*)
      `)
      .eq('id', safetyId)
      .single();

    if (safetyError || !safety) {
      return res.status(404).json({ error: 'Safety entry not found' });
    }

    const { data: requester } = await supabase
      .from('users')
      .select('role, name')
      .eq('id', userId)
      .single();

    if (!requester) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetNodeOrder = parseInt(nodeOrder, 10);
    const targetNode = safety.safety_workflow_nodes.find(n => n.node_order === targetNodeOrder);

    if (!targetNode) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const canNotify = requester.role === 'admin' || safety.created_by === userId || targetNode.executor_id === userId;
    if (!canNotify) {
      return res.status(403).json({ error: 'No permission to send delay notification for this node' });
    }

    const recipientIds = new Set();
    if (targetNode.executor_id) {
      recipientIds.add(targetNode.executor_id);
    }
    safety.safety_assignments
      .filter(a => a.node_order === targetNodeOrder)
      .forEach(a => recipientIds.add(a.user_id));

    const finalMessage = message || `Delay reported on node ${targetNode.node_name} for safety entry ${safety.id}`;

    for (const recipientId of recipientIds) {
      await createNotification(supabase, {
        userId: recipientId,
        title: `Delay Alert: ${targetNode.node_name}`,
        message: finalMessage,
        type: 'warning',
        formType: 'safety',
        formId: safety.id,
        projectId: safety.project_id,
        actionUrl: '/safety',
        metadata: {
          action: 'delay_alert',
          nodeOrder: targetNodeOrder,
          triggeredBy: requester.name
        }
      });
    }

    res.json({
      success: true,
      message: 'Delay notifications sent successfully',
      notifiedUsers: recipientIds.size
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send delay notifications', details: error.message });
  }
});

/**
 * @route   DELETE /api/safety/:id
 * @desc    Delete a safety entry (admin only)
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
      return res.status(403).json({ error: 'Only admin users can delete safety entries' });
    }

    // Check if safety entry exists
    const { data: safety, error: safetyError } = await supabase
      .from('safety_entries')
      .select('id')
      .eq('id', id)
      .single();

    if (safetyError || !safety) {
      return res.status(404).json({ error: 'Safety entry not found' });
    }

    // Delete related workflow nodes first
    await supabase
      .from('safety_workflow_nodes')
      .delete()
      .eq('safety_id', id);

    // Delete related assignments
    await supabase
      .from('safety_assignments')
      .delete()
      .eq('safety_id', id);

    // Delete related comments
    await supabase
      .from('safety_comments')
      .delete()
      .eq('safety_id', id);

    // Delete the safety entry
    const { error: deleteError } = await supabase
      .from('safety_entries')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting safety entry:', deleteError);
      return res.status(500).json({ error: 'Failed to delete safety entry' });
    }

    res.json({ message: 'Safety entry deleted successfully' });

  } catch (error) {
    console.error('Error in delete safety route:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Send workflow notifications via email
 */
async function sendWorkflowNotifications(safetyId, action, supabase, comment = '') {
  try {
    console.log(`=== SENDING SAFETY NOTIFICATIONS FOR ${action.toUpperCase()} ===`);
    console.log(`Safety ID: ${safetyId}`);

    // Get safety entry with all related data
    const { data: safety, error } = await supabase
      .from('safety_entries')
      .select(`
        *,
        safety_workflow_nodes(*),
        safety_assignments(*)
      `)
      .eq('id', safetyId)
      .single();

    if (error || !safety) {
      console.error('Failed to fetch safety for notifications:', error);
      return;
    }

    console.log('Safety data for notifications:', JSON.stringify(safety, null, 2));

    // Get current node
    const currentNode = safety.safety_workflow_nodes
      .find(node => node.node_order === safety.current_node_index);

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
      const currentNodeCCs = safety.safety_assignments.filter(assignment => 
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
      const nextNode = safety.safety_workflow_nodes
        .find(node => node.node_order === safety.current_node_index);

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
      const nextNodeCCs = safety.safety_assignments.filter(assignment => 
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
      const targetNode = safety.safety_workflow_nodes
        .find(node => node.node_order === safety.current_node_index);

      console.log('Target node:', targetNode);

      if (targetNode) {
        if (action === 'rejected') {
          // For rejection, notify admin (creator)
          const { data: creator, error: creatorError } = await supabase
            .from('users')
            .select('*')
            .eq('id', safety.created_by)
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
      const targetNodeCCs = safety.safety_assignments.filter(assignment => 
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
      await sendConsolidatedSafetyEmail(uniqueRecipients, safety, action, comment);
      
      // Create in-app notifications
      try {
        console.log('Creating in-app notifications for safety...');
        
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
            formType: 'safety',
            formId: safety.id,
            projectId: safety.project_id,
            projectName: safety.project,
            action,
            executorId,
            ccUserIds: [], // Don't duplicate CCs here
            comment
          });
        }
        
        // Create notifications for CC users
        for (const ccUserId of ccUserIds) {
          await createFormAssignmentNotifications(supabase, {
            formType: 'safety',
            formId: safety.id,
            projectId: safety.project_id,
            projectName: safety.project,
            action,
            executorId: null,
            ccUserIds: [ccUserId],
            comment
          });
        }
        
        console.log('In-app notifications created successfully for safety');
      } catch (notificationError) {
        console.error('Error creating in-app notifications for safety:', notificationError);
        // Don't fail the whole process if notifications fail
      }
    } else {
      console.log('No recipients found for safety notifications');
    }

    console.log('=== SAFETY NOTIFICATIONS PROCESSING COMPLETE ===');

  } catch (error) {
    console.error('=== SAFETY NOTIFICATION ERROR ===');
    console.error('Error sending workflow notifications:', error);
  }
}

/**
 * Send consolidated safety email to all recipients
 */
async function sendConsolidatedSafetyEmail(recipients, safety, action, comment = '') {
  try {
    console.log(`=== SENDING SAFETY EMAIL FOR ${action.toUpperCase()} ===`);
    console.log(`Recipients count: ${recipients.length}`);
    
    let subject = '';
    let message = '';
    const viewUrl = 'https://server.matrixtwin.com/safety';

    // Separate executors and CCs for personalized messaging
    const executors = recipients.filter(r => r.role_in_workflow === 'executor' || r.role_in_workflow === 'admin');
    const ccs = recipients.filter(r => r.role_in_workflow === 'cc');

    console.log(`Executors: ${executors.length}, CCs: ${ccs.length}`);
    console.log('Executor emails:', executors.map(e => e.email));
    console.log('CC emails:', ccs.map(c => c.email));

    switch (action) {
      case 'created':
        subject = `New Safety Inspection: ${safety.project} - Action Required`;
        message = `
Dear Team,

A new safety inspection has been created for project "${safety.project}" and requires attention.

Project: ${safety.project}
Date: ${safety.date}
Inspector: ${safety.inspector}
Inspection Type: ${safety.inspection_type}
Entry ID: ${safety.id}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and approve for "${e.node_name}"`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): You are CC'd on this safety inspection for "${c.node_name}"`).join('\n')}
` : ''}

Please log in to MatrixTwin to view and take action: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'approved':
        subject = `Safety Inspection Approved: ${safety.project} - Next Action Required`;
        message = `
Dear Team,

A safety inspection for project "${safety.project}" has been approved and moved to the next workflow step.

Project: ${safety.project}
Date: ${safety.date}
Entry ID: ${safety.id}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and approve for "${e.node_name}"`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): Inspection has progressed to "${c.node_name}"`).join('\n')}
` : ''}

Please log in to MatrixTwin to view and take action: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'rejected':
        subject = `Safety Inspection Rejected: ${safety.project} - Admin Action Required`;
        message = `
Dear Team,

A safety inspection for project "${safety.project}" has been rejected and requires admin attention.

Project: ${safety.project}
Date: ${safety.date}
Entry ID: ${safety.id}

${comment ? `Rejection Reason: ${comment}` : ''}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and resolve the issues`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): Inspection has been rejected and needs revision`).join('\n')}
` : ''}

Please log in to MatrixTwin to review and resolve: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'sent_back':
        subject = `Safety Inspection Sent Back: ${safety.project} - Review Required`;
        message = `
Dear Team,

A safety inspection for project "${safety.project}" has been sent back for review.

Project: ${safety.project}
Date: ${safety.date}
Entry ID: ${safety.id}

${comment ? `Comments: ${comment}` : ''}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review the comments and take action for "${e.node_name}"`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): Inspection has been sent back for review`).join('\n')}
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

    const emailResult = await sendEmail(
      allEmails,
      subject,
      message,
      message.replace(/\n/g, '<br>')
    );

    console.log('Email send result:', emailResult);
    console.log(`Consolidated email sent successfully to ${allEmails.length} recipients for safety ${safety.id}`);

  } catch (error) {
    console.error('=== SAFETY EMAIL SENDING ERROR ===');
    console.error('Error sending consolidated safety email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
  }
}

/**
 * @route   POST /api/safety/:safetyId/restore
 * @desc    Restore safety entry from history
 * @access  Private
 */
router.post('/:safetyId/restore', auth, disableRLS, async (req, res) => {
  try {
    const { safetyId } = req.params;
    const { historyId } = req.body;
    const userId = req.user.id;
    const supabase = req.supabaseAdmin || req.supabase;

    // Get history entry
    const { data: historyEntry, error: historyError } = await supabase
      .from('safety_entry_history')
      .select('*')
      .eq('id', historyId)
      .eq('safety_id', safetyId)
      .single();

    if (historyError || !historyEntry) {
      return res.status(404).json({ error: 'History entry not found' });
    }

    // Get current safety entry
    const { data: safety, error: safetyError } = await supabase
      .from('safety_entries')
      .select('*')
      .eq('id', safetyId)
      .single();

    if (safetyError || !safety) {
      return res.status(404).json({ error: 'Safety entry not found' });
    }

    // Check permissions (same as update)
    const canUpdate = req.user.role === 'admin' || 
                      safety.created_by === userId;
    
    if (!canUpdate) {
      return res.status(403).json({ error: 'No permission to restore this safety entry' });
    }

    // Update main entry with historical data
    const { error: updateError } = await supabase
      .from('safety_entries')
      .update({
        form_data: historyEntry.form_data,
        updated_at: new Date().toISOString(),
        // Restore flattened fields
        safety_score: parseInt(historyEntry.form_data.overallSafetyScore?.replace('%', '')) || safety.safety_score,
        incidents_reported: historyEntry.form_data.nonComplianceDetails || safety.incidents_reported,
        corrective_actions: historyEntry.form_data.recommendedActions || safety.corrective_actions,
        notes: historyEntry.form_data.immediateActions || safety.notes
      })
      .eq('id', safetyId);

    if (updateError) throw updateError;

    // Record this restoration in history
    await supabase
      .from('safety_entry_history')
      .insert([{
        safety_id: safetyId,
        changed_by: userId,
        changed_at: new Date().toISOString(),
        form_data: historyEntry.form_data,
        change_reason: `restored_from_${historyId}`,
        node_order: safety.current_node_index
      }]);

    res.json({
      success: true,
      message: 'Safety entry restored successfully',
      data: historyEntry.form_data
    });

  } catch (error) {
    console.error('Error restoring safety entry:', error);
    res.status(500).json({ 
      error: 'Failed to restore safety entry',
      details: error.message 
    });
  }
});

module.exports = router; 
