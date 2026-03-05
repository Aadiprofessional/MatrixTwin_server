const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/email');
const { createFormAssignmentNotifications } = require('./notifications');

// Middleware to temporarily disable RLS for inspection operations
const disableRLS = async (req, res, next) => {
  try {
    // Create a new supabase client with service role key for bypassing RLS
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

/**
 * @route   POST /api/inspection/create
 * @desc    Create a new inspection entry with workflow
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

    console.log('=== INSPECTION CREATION START ===');
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
      console.error('Non-admin user attempted to create inspection entry:', user);
      return res.status(403).json({ error: 'Only admins can create inspection entries' });
    }

    // Create inspection entry
    const inspectionEntry = {
      id: formId || `inspection_${Date.now()}`,
      date: formData.inspectionDate || new Date().toISOString().split('T')[0],
      project: projectId || formData.projectId || 'Unknown Project',
      project_id: projectId,
      inspector: formData.inspectedBy || user.name,
      contract_no: formData.contractNo || '',
      risc_no: formData.riscNo || '',
      revision: formData.revision || '',
      supervisor: formData.supervisor || '',
      attention: formData.attention || '',
      location: formData.location || '',
      works_to_be_inspected: formData.worksToBeInspected || '',
      works_category: formData.worksCategory || 'General',
      inspection_time: formData.inspectionTime || '',
      next_operation: formData.nextOperation || '',
      general_cleaning: formData.generalCleaning || '',
      scheduled_time: formData.scheduledTime || '',
      scheduled_date: formData.scheduledDate || '',
      equipment: formData.equipment || '',
      no_objection: formData.noObjection || false,
      deficiencies_noted: formData.deficienciesNoted || false,
      deficiencies: formData.deficiencies || [],
      form_data: {
        ...formData,
        name: name || formData.name || formData.formNumber // Ensure name is saved
      },
      created_by: createdBy,
      created_at: new Date().toISOString(),
      status: 'pending',
      current_node_index: 1,
      current_active_node: processNodes.find(n => n.type === 'node')?.id || null
    };

    console.log('Inspection entry to insert:', inspectionEntry);

    // Insert inspection entry
    const { data: insertedInspection, error: inspectionError } = await supabase
      .from('inspection_entries')
      .insert([inspectionEntry])
      .select()
      .single();

    if (inspectionError) {
      console.error('Failed to insert inspection entry:', inspectionError);
      throw inspectionError;
    }

    console.log('Inspection entry inserted successfully:', insertedInspection);

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
        inspection_id: insertedInspection.id,
        node_id: node.id,
        node_type: node.type,
        node_name: node.name,
        executor_id: executorId,
        executor_name: executorName,
        node_order: index,
        status: index === 1 ? 'pending' : 'waiting',
        edit_access: node.editAccess !== false,
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
      .from('inspection_workflow_nodes')
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
            inspection_id: insertedInspection.id,
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
        .from('inspection_assignments')
        .insert(allAssignments);

      if (ccError) {
        console.error('Failed to insert CC assignments:', ccError);
        throw ccError;
      }
      console.log('CC assignments inserted successfully');
    }

    // Send initial notifications with detailed logging
    console.log('Sending workflow notifications...');
    await sendWorkflowNotifications(insertedInspection.id, 'created', supabase);
    console.log('Workflow notifications sent');

    console.log('=== INSPECTION CREATION SUCCESS ===');

    res.status(201).json({
      success: true,
      inspection: insertedInspection,
      message: 'Inspection entry created successfully'
    });

  } catch (error) {
    console.error('=== INSPECTION CREATION ERROR ===');
    console.error('Error creating inspection entry:', error);
    res.status(500).json({ 
      error: 'Failed to create inspection entry',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/inspection/list/:userId
 * @desc    Get inspection entries for a user based on their role and active project
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

    let inspectionQuery = supabase
      .from('inspection_entries')
      .select(`
        *,
        inspection_workflow_nodes(*),
        inspection_assignments(*),
        inspection_comments(*)
      `);

    // Filter by project if projectId is provided
    if (projectId) {
      inspectionQuery = inspectionQuery.eq('project_id', projectId);
    }

    // Filter based on user role
    if (user.role === 'admin') {
      console.log('Admin user - showing all entries');
    } else {
      // For non-admin users, get their assignments first
      const { data: assignments, error: assignError } = await supabase
        .from('inspection_assignments')
        .select('inspection_id')
        .eq('user_id', userId);

      if (assignError) {
        console.error('Error fetching assignments:', assignError);
      }

      const assignedInspectionIds = assignments?.map(a => a.inspection_id) || [];
      console.log(`User ${userId} is assigned to inspection entries:`, assignedInspectionIds);

      // Build OR condition for entries user can see
      const conditions = [`created_by.eq.${userId}`];

      if (assignedInspectionIds.length > 0) {
        conditions.push(`id.in.(${assignedInspectionIds.join(',')})`);
      }

      // Also check if user is an executor in any workflow nodes
      const { data: executorNodes, error: executorError } = await supabase
        .from('inspection_workflow_nodes')
        .select('inspection_id')
        .eq('executor_id', userId);

      if (!executorError && executorNodes && executorNodes.length > 0) {
        const executorInspectionIds = executorNodes.map(n => n.inspection_id);
        console.log(`User ${userId} is executor for inspection entries:`, executorInspectionIds);
        if (executorInspectionIds.length > 0) {
          conditions.push(`id.in.(${executorInspectionIds.join(',')})`);
        }
      }

      if (conditions.length > 1) {
        inspectionQuery = inspectionQuery.or(conditions.join(','));
      } else {
        inspectionQuery = inspectionQuery.eq('created_by', userId);
      }

      console.log(`Applied filter conditions for user ${userId}:`, conditions);
    }

    const { data: inspectionEntries, error: inspectionError } = await inspectionQuery
      .order('created_at', { ascending: false });

    if (inspectionError) {
      console.error('Error fetching inspection entries:', inspectionError);
      throw inspectionError;
    }

    console.log(`Returning ${inspectionEntries?.length || 0} inspection entries for user ${userId}`);
    res.json(inspectionEntries || []);

  } catch (error) {
    console.error('Error fetching inspection entries:', error);
    res.status(500).json({ 
      error: 'Failed to fetch inspection entries',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/inspection/:inspectionId
 * @desc    Get specific inspection entry with workflow details
 * @access  Private
 */
router.get('/:inspectionId', auth, disableRLS, async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const supabase = req.supabaseAdmin || req.supabase;

    const { data: inspection, error: inspectionError } = await supabase
      .from('inspection_entries')
      .select(`
        *,
        inspection_workflow_nodes(*),
        inspection_assignments(*),
        inspection_comments(*)
      `)
      .eq('id', inspectionId)
      .single();

    if (inspectionError) throw inspectionError;

    if (!inspection) {
      return res.status(404).json({ error: 'Inspection entry not found' });
    }

    res.json(inspection);

  } catch (error) {
    console.error('Error fetching inspection entry:', error);
    res.status(500).json({ 
      error: 'Failed to fetch inspection entry',
      details: error.message 
    });
  }
});

/**
 * @route   PUT /api/inspection/:inspectionId/update
 * @desc    Update inspection entry and advance workflow
 * @access  Private
 */
router.put('/:inspectionId/update', auth, disableRLS, async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { 
      formData, 
      action,
      comment,
      userId 
    } = req.body;

    const supabase = req.supabaseAdmin || req.supabase;

    // Get current inspection entry
    const { data: inspection, error: inspectionError } = await supabase
      .from('inspection_entries')
      .select(`
        *,
        inspection_workflow_nodes(*),
        inspection_assignments(*)
      `)
      .eq('id', inspectionId)
      .single();

    if (inspectionError || !inspection) {
      return res.status(404).json({ error: 'Inspection entry not found' });
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
    const currentNode = inspection.inspection_workflow_nodes
      .find(node => node.node_order === inspection.current_node_index);

    const canUpdate = user.role === 'admin' || 
                     inspection.created_by === userId ||
                     inspection.inspection_assignments.some(a => a.user_id === userId) ||
                     (currentNode && currentNode.executor_id === userId);

    if (!canUpdate) {
      return res.status(403).json({ error: 'No permission to update this inspection entry' });
    }

    // Update form data if provided
    if (formData) {
      const { error: updateError } = await supabase
        .from('inspection_entries')
        .update({
          form_data: formData,
          contract_no: formData.contractNo || inspection.contract_no,
          risc_no: formData.riscNo || inspection.risc_no,
          revision: formData.revision || inspection.revision,
          supervisor: formData.supervisor || inspection.supervisor,
          attention: formData.attention || inspection.attention,
          location: formData.location || inspection.location,
          works_to_be_inspected: formData.worksToBeInspected || inspection.works_to_be_inspected,
          works_category: formData.worksCategory || inspection.works_category,
          inspection_time: formData.inspectionTime || inspection.inspection_time,
          next_operation: formData.nextOperation || inspection.next_operation,
          general_cleaning: formData.generalCleaning || inspection.general_cleaning,
          scheduled_time: formData.scheduledTime || inspection.scheduled_time,
          scheduled_date: formData.scheduledDate || inspection.scheduled_date,
          equipment: formData.equipment || inspection.equipment,
          no_objection: formData.noObjection !== undefined ? formData.noObjection : inspection.no_objection,
          deficiencies_noted: formData.deficienciesNoted !== undefined ? formData.deficienciesNoted : inspection.deficiencies_noted,
          deficiencies: formData.deficiencies || inspection.deficiencies,
          updated_at: new Date().toISOString()
        })
        .eq('id', inspectionId);

      if (updateError) throw updateError;
    }

    // Add comment if provided
    if (comment) {
      const { error: commentError } = await supabase
        .from('inspection_comments')
        .insert([{
          inspection_id: inspectionId,
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
        .from('inspection_workflow_history')
        .insert([{
          inspection_id: inspectionId,
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
        .from('inspection_workflow_nodes')
        .update({
          status: 'completed',
          completed_by: userId,
          completed_at: new Date().toISOString(),
          completion_count: newCompletionCount,
          last_completed_at: new Date().toISOString(),
          can_re_edit: canReEdit
        })
        .eq('inspection_id', inspectionId)
        .eq('node_order', inspection.current_node_index);

      // Move to next node or complete
      const nextNodeIndex = inspection.current_node_index + 1;
      const nextNode = inspection.inspection_workflow_nodes
        .find(node => node.node_order === nextNodeIndex);

      if (nextNode) {
        // Activate next node
        await supabase
          .from('inspection_workflow_nodes')
          .update({ status: 'pending' })
          .eq('inspection_id', inspectionId)
          .eq('node_order', nextNodeIndex);

        await supabase
          .from('inspection_entries')
          .update({
            current_node_index: nextNodeIndex,
            current_active_node: nextNode.node_id
          })
          .eq('id', inspectionId);
      } else {
        // Complete the workflow
        await supabase
          .from('inspection_entries')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            current_active_node: null
          })
          .eq('id', inspectionId);
      }

      // Send notifications
      await sendWorkflowNotifications(inspectionId, 'approved', supabase, comment);

    } else if (action === 'reject') {
      // Mark current node as rejected
      await supabase
        .from('inspection_workflow_nodes')
        .update({
          status: 'rejected',
          completed_by: userId,
          completed_at: new Date().toISOString()
        })
        .eq('inspection_id', inspectionId)
        .eq('node_order', inspection.current_node_index);

      // Find the first node that can still be re-edited
      const firstEditableNode = inspection.inspection_workflow_nodes
        .filter(n => n.node_order >= 1)
        .sort((a, b) => a.node_order - b.node_order)
        .find(n => n.can_re_edit !== false && (n.completion_count || 0) < (n.max_completions || 2));

      if (!firstEditableNode) {
        // No nodes can be re-edited, mark as permanently rejected
        await supabase
          .from('inspection_entries')
          .update({
            status: 'permanently_rejected',
            current_node_index: null,
            current_active_node: null
          })
          .eq('id', inspectionId);

        return res.json({
          success: true,
          message: 'Inspection entry permanently rejected - no more edits allowed',
          permanently_rejected: true
        });
      }

      // Send back to first editable node
      await supabase
        .from('inspection_entries')
        .update({
          status: 'rejected',
          current_node_index: firstEditableNode.node_order,
          current_active_node: firstEditableNode.node_id
        })
        .eq('id', inspectionId);

      // Reset all nodes after the target node to waiting
      await supabase
        .from('inspection_workflow_nodes')
        .update({ status: 'waiting' })
        .eq('inspection_id', inspectionId)
        .gt('node_order', firstEditableNode.node_order);

      // Reactivate target node
      await supabase
        .from('inspection_workflow_nodes')
        .update({ status: 'pending' })
        .eq('inspection_id', inspectionId)
        .eq('node_order', firstEditableNode.node_order);

      // Send rejection notifications
      await sendWorkflowNotifications(inspectionId, 'rejected', supabase, comment);

    } else if (action === 'back') {
      // Find the previous node that can still be re-edited
      const prevEditableNode = inspection.inspection_workflow_nodes
        .filter(n => n.node_order < inspection.current_node_index && n.node_order >= 1)
        .sort((a, b) => b.node_order - a.node_order)
        .find(n => n.can_re_edit !== false && (n.completion_count || 0) < (n.max_completions || 2));

      if (!prevEditableNode) {
        return res.status(400).json({ 
          error: 'No previous node available for editing',
          details: 'All previous nodes have reached their completion limit'
        });
      }
      
      // Mark current node as sent back
      await supabase
        .from('inspection_workflow_nodes')
        .update({
          status: 'sent_back',
          completed_by: userId,
          completed_at: new Date().toISOString()
        })
        .eq('inspection_id', inspectionId)
        .eq('node_order', inspection.current_node_index);

      // Activate previous editable node
      await supabase
        .from('inspection_workflow_nodes')
        .update({ status: 'pending' })
        .eq('inspection_id', inspectionId)
        .eq('node_order', prevEditableNode.node_order);

      await supabase
        .from('inspection_entries')
        .update({ 
          current_node_index: prevEditableNode.node_order,
          current_active_node: prevEditableNode.node_id
        })
        .eq('id', inspectionId);

      // Send back notifications
      await sendWorkflowNotifications(inspectionId, 'sent_back', supabase, comment);
    }

    res.json({
      success: true,
      message: 'Inspection entry updated successfully'
    });

  } catch (error) {
    console.error('Error updating inspection entry:', error);
    res.status(500).json({ 
      error: 'Failed to update inspection entry',
      details: error.message 
    });
  }
});

/**
 * @route   DELETE /api/inspection/:id
 * @desc    Delete an inspection entry (admin only)
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
      return res.status(403).json({ error: 'Only admin users can delete inspection entries' });
    }

    // Check if inspection entry exists
    const { data: inspection, error: inspectionError } = await supabase
      .from('inspection_entries')
      .select('id')
      .eq('id', id)
      .single();

    if (inspectionError || !inspection) {
      return res.status(404).json({ error: 'Inspection entry not found' });
    }

    // Delete related workflow nodes first
    await supabase
      .from('inspection_workflow_nodes')
      .delete()
      .eq('inspection_id', id);

    // Delete related assignments
    await supabase
      .from('inspection_assignments')
      .delete()
      .eq('inspection_id', id);

    // Delete related comments
    await supabase
      .from('inspection_comments')
      .delete()
      .eq('inspection_id', id);

    // Delete the inspection entry
    const { error: deleteError } = await supabase
      .from('inspection_entries')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting inspection entry:', deleteError);
      return res.status(500).json({ error: 'Failed to delete inspection entry' });
    }

    res.json({ message: 'Inspection entry deleted successfully' });

  } catch (error) {
    console.error('Error in delete inspection route:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Send workflow notifications via email
 */
async function sendWorkflowNotifications(inspectionId, action, supabase, comment = '') {
  try {
    console.log(`=== SENDING INSPECTION NOTIFICATIONS FOR ${action.toUpperCase()} ===`);
    console.log(`Inspection ID: ${inspectionId}`);

    // Get inspection entry with all related data
    const { data: inspection, error } = await supabase
      .from('inspection_entries')
      .select(`
        *,
        inspection_workflow_nodes(*),
        inspection_assignments(*)
      `)
      .eq('id', inspectionId)
      .single();

    if (error || !inspection) {
      console.error('Failed to fetch inspection for notifications:', error);
      return;
    }

    console.log('Inspection data for notifications:', JSON.stringify(inspection, null, 2));

    // Get current node
    const currentNode = inspection.inspection_workflow_nodes
      .find(node => node.node_order === inspection.current_node_index);

    console.log('Current node:', currentNode);

    // Collect all recipients with proper deduplication
    let recipients = new Map();

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
      const currentNodeCCs = inspection.inspection_assignments.filter(assignment => 
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
      const nextNode = inspection.inspection_workflow_nodes
        .find(node => node.node_order === inspection.current_node_index);

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
      const nextNodeCCs = inspection.inspection_assignments.filter(assignment => 
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
      const targetNode = inspection.inspection_workflow_nodes
        .find(node => node.node_order === inspection.current_node_index);

      console.log('Target node:', targetNode);

      if (targetNode) {
        if (action === 'rejected') {
          // For rejection, notify admin (creator)
          const { data: creator, error: creatorError } = await supabase
            .from('users')
            .select('*')
            .eq('id', inspection.created_by)
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
      const targetNodeCCs = inspection.inspection_assignments.filter(assignment => 
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
      await sendConsolidatedInspectionEmail(uniqueRecipients, inspection, action, comment);
      
      // Create in-app notifications
      try {
        console.log('Creating in-app notifications for inspection...');
        
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
            formType: 'inspection',
            formId: inspection.id,
            projectId: inspection.project_id,
            projectName: inspection.project,
            action,
            executorId,
            ccUserIds: [],
            comment
          });
        }
        
        // Create notifications for CC users
        for (const ccUserId of ccUserIds) {
          await createFormAssignmentNotifications(supabase, {
            formType: 'inspection',
            formId: inspection.id,
            projectId: inspection.project_id,
            projectName: inspection.project,
            action,
            executorId: null,
            ccUserIds: [ccUserId],
            comment
          });
        }
        
        console.log('In-app notifications created successfully for inspection');
      } catch (notificationError) {
        console.error('Error creating in-app notifications for inspection:', notificationError);
      }
    } else {
      console.log('No recipients found for inspection notifications');
    }

    console.log('=== INSPECTION NOTIFICATIONS PROCESSING COMPLETE ===');

  } catch (error) {
    console.error('=== INSPECTION NOTIFICATION ERROR ===');
    console.error('Error sending workflow notifications:', error);
  }
}

/**
 * Send consolidated inspection email to all recipients
 */
async function sendConsolidatedInspectionEmail(recipients, inspection, action, comment = '') {
  try {
    console.log(`=== SENDING INSPECTION EMAIL FOR ${action.toUpperCase()} ===`);
    console.log(`Recipients count: ${recipients.length}`);
    
    let subject = '';
    let message = '';
    const viewUrl = 'https://server.matrixtwin.com/inspection';

    // Separate executors and CCs for personalized messaging
    const executors = recipients.filter(r => r.role_in_workflow === 'executor' || r.role_in_workflow === 'admin');
    const ccs = recipients.filter(r => r.role_in_workflow === 'cc');

    console.log(`Executors: ${executors.length}, CCs: ${ccs.length}`);
    console.log('Executor emails:', executors.map(e => e.email));
    console.log('CC emails:', ccs.map(c => c.email));

    switch (action) {
      case 'created':
        subject = `New Inspection Check: ${inspection.project} - Action Required`;
        message = `
Dear Team,

A new inspection check has been created for project "${inspection.project}" and requires attention.

Project: ${inspection.project}
Date: ${inspection.date}
Inspector: ${inspection.inspector}
Contract No: ${inspection.contract_no}
Location: ${inspection.location}
Entry ID: ${inspection.id}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and approve for "${e.node_name}"`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): You are CC'd on this inspection check for "${c.node_name}"`).join('\n')}
` : ''}

Please log in to MatrixTwin to view and take action: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'approved':
        subject = `Inspection Check Approved: ${inspection.project} - Next Action Required`;
        message = `
Dear Team,

An inspection check for project "${inspection.project}" has been approved and moved to the next workflow step.

Project: ${inspection.project}
Date: ${inspection.date}
Entry ID: ${inspection.id}

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
        subject = `Inspection Check Rejected: ${inspection.project} - Admin Action Required`;
        message = `
Dear Team,

An inspection check for project "${inspection.project}" has been rejected and requires admin attention.

Project: ${inspection.project}
Date: ${inspection.date}
Entry ID: ${inspection.id}

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
        subject = `Inspection Check Sent Back: ${inspection.project} - Review Required`;
        message = `
Dear Team,

An inspection check for project "${inspection.project}" has been sent back for review.

Project: ${inspection.project}
Date: ${inspection.date}
Entry ID: ${inspection.id}

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
    console.log(`Consolidated email sent successfully to ${allEmails.length} recipients for inspection ${inspection.id}`);

  } catch (error) {
    console.error('=== INSPECTION EMAIL SENDING ERROR ===');
    console.error('Error sending consolidated inspection email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
  }
}

module.exports = router; 