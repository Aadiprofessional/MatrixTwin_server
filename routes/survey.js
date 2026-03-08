const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { createFormAssignmentNotifications } = require('./notifications');

// Middleware to temporarily disable RLS for survey operations
const disableRLS = async (req, res, next) => {
  try {
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

/**
 * @route   POST /api/survey/create
 * @desc    Create a new survey entry with workflow
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

    console.log('=== SURVEY CREATION START ===');
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
      console.error('Non-admin user attempted to create survey entry:', user);
      return res.status(403).json({ error: 'Only admins can create survey entries' });
    }

    // Create survey entry
    const surveyEntry = {
      id: formId || `survey_${Date.now()}`,
      date: formData.surveyDate || formData.inspectionDate || new Date().toISOString().split('T')[0],
      project: projectId || formData.projectId || 'Unknown Project',
      project_id: projectId,
      surveyor: formData.surveyor || formData.surveyedBy || user.name,
      contract_no: formData.contractNo || '',
      risc_no: formData.riscNo || '',
      revision: formData.revision || '',
      supervisor: formData.supervisor || '',
      attention: formData.attention || '',
      location: formData.location || '',
      survey_field: formData.survey || '',
      works_category: formData.worksCategory || 'General',
      survey_time: formData.surveyTime || formData.inspectionTime || '',
      next_operation: formData.nextOperation || '',
      scheduled_time: formData.scheduledTime || '',
      scheduled_date: formData.scheduledDate || null,
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

    console.log('Survey entry to insert:', surveyEntry);

    // Insert survey entry
    const { data: insertedSurvey, error: surveyError } = await supabase
      .from('survey_entries')
      .insert([surveyEntry])
      .select()
      .single();

    if (surveyError) {
      console.error('Failed to insert survey entry:', surveyError);
      throw surveyError;
    }

    console.log('Survey entry inserted successfully:', insertedSurvey);

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
        survey_id: insertedSurvey.id,
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
      .from('survey_workflow_nodes')
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
            survey_id: insertedSurvey.id,
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
        .from('survey_assignments')
        .insert(allAssignments);

      if (ccError) {
        console.error('Failed to insert CC assignments:', ccError);
        throw ccError;
      }
      console.log('CC assignments inserted successfully');
    }

    // Send initial notifications with detailed logging
    console.log('Sending workflow notifications...');
    await sendWorkflowNotifications(insertedSurvey.id, 'created', supabase);
    console.log('Workflow notifications sent');

    console.log('=== SURVEY CREATION SUCCESS ===');

    res.status(201).json({
      success: true,
      survey: insertedSurvey,
      message: 'Survey entry created successfully'
    });

  } catch (error) {
    console.error('=== SURVEY CREATION ERROR ===');
    console.error('Error creating survey entry:', error);
    res.status(500).json({ 
      error: 'Failed to create survey entry',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/survey/list/:userId
 * @desc    Get survey entries for a user based on their role and active project
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

    let surveyQuery = supabase
      .from('survey_entries')
      .select(`
        *,
        survey_workflow_nodes(*),
        survey_assignments(*),
        survey_comments(*)
      `);

    // Filter by project if projectId is provided
    if (projectId) {
      surveyQuery = surveyQuery.eq('project_id', projectId);
    }

    // Filter based on user role
    if (user.role === 'admin') {
      console.log('Admin user - showing all entries');
    } else {
      // For non-admin users, get their assignments first
      const { data: assignments, error: assignError } = await supabase
        .from('survey_assignments')
        .select('survey_id')
        .eq('user_id', userId);

      if (assignError) {
        console.error('Error fetching assignments:', assignError);
      }

      const assignedSurveyIds = assignments?.map(a => a.survey_id) || [];
      console.log(`User ${userId} is assigned to survey entries:`, assignedSurveyIds);

      // Build OR condition for entries user can see
      const conditions = [`created_by.eq.${userId}`];

      if (assignedSurveyIds.length > 0) {
        conditions.push(`id.in.(${assignedSurveyIds.join(',')})`);
      }

      // Also check if user is an executor in any workflow nodes
      const { data: executorNodes, error: executorError } = await supabase
        .from('survey_workflow_nodes')
        .select('survey_id')
        .eq('executor_id', userId);

      if (!executorError && executorNodes && executorNodes.length > 0) {
        const executorSurveyIds = executorNodes.map(n => n.survey_id);
        console.log(`User ${userId} is executor for survey entries:`, executorSurveyIds);
        if (executorSurveyIds.length > 0) {
          conditions.push(`id.in.(${executorSurveyIds.join(',')})`);
        }
      }

      if (conditions.length > 1) {
        surveyQuery = surveyQuery.or(conditions.join(','));
      } else {
        surveyQuery = surveyQuery.eq('created_by', userId);
      }

      console.log(`Applied filter conditions for user ${userId}:`, conditions);
    }

    const { data: surveyEntries, error: surveyError } = await surveyQuery
      .order('created_at', { ascending: false });

    if (surveyError) {
      console.error('Error fetching survey entries:', surveyError);
      throw surveyError;
    }

    console.log(`Returning ${surveyEntries?.length || 0} survey entries for user ${userId}`);
    res.json(surveyEntries || []);

  } catch (error) {
    console.error('Error fetching survey entries:', error);
    res.status(500).json({ 
      error: 'Failed to fetch survey entries',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/survey/:surveyId
 * @desc    Get specific survey entry with workflow details
 * @access  Private
 */
router.get('/:surveyId', auth, disableRLS, async (req, res) => {
  try {
    const { surveyId } = req.params;
    const supabase = req.supabaseAdmin || req.supabase;

    const { data: survey, error: surveyError } = await supabase
      .from('survey_entries')
      .select(`
        *,
        survey_workflow_nodes(*),
        survey_assignments(*),
        survey_comments(*)
      `)
      .eq('id', surveyId)
      .single();

    if (surveyError) throw surveyError;

    if (!survey) {
      return res.status(404).json({ error: 'Survey entry not found' });
    }

    res.json(survey);

  } catch (error) {
    console.error('Error fetching survey entry:', error);
    res.status(500).json({ 
      error: 'Failed to fetch survey entry',
      details: error.message 
    });
  }
});

/**
 * @route   GET /api/survey/:surveyId/history
 * @desc    Get history of changes for a survey entry
 * @access  Private
 */
router.get('/:surveyId/history', auth, disableRLS, async (req, res) => {
  try {
    const { surveyId } = req.params;
    const supabase = req.supabaseAdmin || req.supabase;

    const { data: history, error: historyError } = await supabase
      .from('survey_entry_history')
      .select(`
        *,
        users:changed_by (name, email)
      `)
      .eq('survey_id', surveyId)
      .order('changed_at', { ascending: false });

    if (historyError) throw historyError;

    res.json(history);
  } catch (error) {
    console.error('Error fetching survey history:', error);
    res.status(500).json({ 
      error: 'Failed to fetch survey history',
      details: error.message 
    });
  }
});

/**
 * @route   PUT /api/survey/:surveyId/update
 * @desc    Update survey entry and advance workflow
 * @access  Private
 */
router.put('/:surveyId/update', auth, disableRLS, async (req, res) => {
  try {
    const { surveyId } = req.params;
    const { 
      formData, 
      action,
      comment,
      userId 
    } = req.body;

    const supabase = req.supabaseAdmin || req.supabase;

    // Get current survey entry
    const { data: survey, error: surveyError } = await supabase
      .from('survey_entries')
      .select(`
        *,
        survey_workflow_nodes(*),
        survey_assignments(*)
      `)
      .eq('id', surveyId)
      .single();

    if (surveyError || !survey) {
      return res.status(404).json({ error: 'Survey entry not found' });
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
    const currentNode = survey.survey_workflow_nodes
      .find(node => node.node_order === survey.current_node_index);

    const canUpdate = user.role === 'admin' || 
                     survey.created_by === userId ||
                     survey.survey_assignments.some(a => a.user_id === userId) ||
                     (currentNode && currentNode.executor_id === userId);

    if (!canUpdate) {
      return res.status(403).json({ error: 'No permission to update this survey entry' });
    }

    // Update form data if provided
    if (formData) {
      // Create history entry
      const historyEntry = {
        survey_id: surveyId,
        changed_by: userId,
        changed_at: new Date().toISOString(),
        form_data: formData,
        change_reason: action || 'update'
      };

      const { error: historyError } = await supabase
        .from('survey_entry_history')
        .insert([historyEntry]);

      if (historyError) {
        console.error('Failed to save survey history:', historyError);
        // Continue with update even if history fails, but log it
      }

      const { error: updateError } = await supabase
        .from('survey_entries')
        .update({
          form_data: formData,
          contract_no: formData.contractNo || survey.contract_no,
          risc_no: formData.riscNo || survey.risc_no,
          revision: formData.revision || survey.revision,
          supervisor: formData.supervisor || survey.supervisor,
          attention: formData.attention || survey.attention,
          location: formData.location || survey.location,
          survey_field: formData.survey || survey.survey_field,
          works_category: formData.worksCategory || survey.works_category,
          survey_time: formData.surveyTime || formData.inspectionTime || survey.survey_time,
          next_operation: formData.nextOperation || survey.next_operation,
          scheduled_time: formData.scheduledTime || survey.scheduled_time,
          scheduled_date: formData.scheduledDate || survey.scheduled_date || null,
          equipment: formData.equipment || survey.equipment,
          no_objection: formData.noObjection !== undefined ? formData.noObjection : survey.no_objection,
          deficiencies_noted: formData.deficienciesNoted !== undefined ? formData.deficienciesNoted : survey.deficiencies_noted,
          deficiencies: formData.deficiencies || survey.deficiencies,
          updated_at: new Date().toISOString()
        })
        .eq('id', surveyId);

      if (updateError) throw updateError;
    }

    // Add comment if provided
    if (comment) {
      const { error: commentError } = await supabase
        .from('survey_comments')
        .insert([{
          survey_id: surveyId,
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
        .from('survey_workflow_history')
        .insert([{
          survey_id: surveyId,
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
        .from('survey_workflow_nodes')
        .update({
          status: 'completed',
          completed_by: userId,
          completed_at: new Date().toISOString(),
          completion_count: newCompletionCount,
          last_completed_at: new Date().toISOString(),
          can_re_edit: canReEdit
        })
        .eq('survey_id', surveyId)
        .eq('node_order', survey.current_node_index);

      // Move to next node or complete
      const nextNodeIndex = survey.current_node_index + 1;
      const nextNode = survey.survey_workflow_nodes
        .find(node => node.node_order === nextNodeIndex);

      if (nextNode) {
        // Activate next node
        await supabase
          .from('survey_workflow_nodes')
          .update({ status: 'pending' })
          .eq('survey_id', surveyId)
          .eq('node_order', nextNodeIndex);

        await supabase
          .from('survey_entries')
          .update({
            current_node_index: nextNodeIndex,
            current_active_node: nextNode.node_id
          })
          .eq('id', surveyId);
      } else {
        // Complete the workflow
        await supabase
          .from('survey_entries')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            current_active_node: null
          })
          .eq('id', surveyId);
      }

      // Send notifications
      await sendWorkflowNotifications(surveyId, 'approved', supabase, comment);

    } else if (action === 'reject') {
      // Mark current node as rejected
      await supabase
        .from('survey_workflow_nodes')
        .update({
          status: 'rejected',
          completed_by: userId,
          completed_at: new Date().toISOString()
        })
        .eq('survey_id', surveyId)
        .eq('node_order', survey.current_node_index);

      // Find the first node that can still be re-edited
      const firstEditableNode = survey.survey_workflow_nodes
        .filter(n => n.node_order >= 1)
        .sort((a, b) => a.node_order - b.node_order)
        .find(n => n.can_re_edit !== false && (n.completion_count || 0) < (n.max_completions || 2));

      if (!firstEditableNode) {
        // No nodes can be re-edited, mark as permanently rejected
        await supabase
          .from('survey_entries')
          .update({
            status: 'permanently_rejected',
            current_node_index: null,
            current_active_node: null
          })
          .eq('id', surveyId);

        return res.json({
          success: true,
          message: 'Survey entry permanently rejected - no more edits allowed',
          permanently_rejected: true
        });
      }

      // Send back to first editable node
      await supabase
        .from('survey_entries')
        .update({
          status: 'rejected',
          current_node_index: firstEditableNode.node_order,
          current_active_node: firstEditableNode.node_id
        })
        .eq('id', surveyId);

      // Reset all nodes after the target node to waiting
      await supabase
        .from('survey_workflow_nodes')
        .update({ status: 'waiting' })
        .eq('survey_id', surveyId)
        .gt('node_order', firstEditableNode.node_order);

      // Reactivate target node
      await supabase
        .from('survey_workflow_nodes')
        .update({ status: 'pending' })
        .eq('survey_id', surveyId)
        .eq('node_order', firstEditableNode.node_order);

      // Send rejection notifications
      await sendWorkflowNotifications(surveyId, 'rejected', supabase, comment);

    } else if (action === 'back') {
      // Find the previous node that can still be re-edited
      const prevEditableNode = survey.survey_workflow_nodes
        .filter(n => n.node_order < survey.current_node_index && n.node_order >= 1)
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
        .from('survey_workflow_nodes')
        .update({
          status: 'sent_back',
          completed_by: userId,
          completed_at: new Date().toISOString()
        })
        .eq('survey_id', surveyId)
        .eq('node_order', survey.current_node_index);

      // Activate previous editable node
      await supabase
        .from('survey_workflow_nodes')
        .update({ status: 'pending' })
        .eq('survey_id', surveyId)
        .eq('node_order', prevEditableNode.node_order);

      await supabase
        .from('survey_entries')
        .update({ 
          current_node_index: prevEditableNode.node_order,
          current_active_node: prevEditableNode.node_id
        })
        .eq('id', surveyId);

      // Send back notifications
      await sendWorkflowNotifications(surveyId, 'sent_back', supabase, comment);
    }

    res.json({
      success: true,
      message: 'Survey entry updated successfully'
    });

  } catch (error) {
    console.error('Error updating survey entry:', error);
    res.status(500).json({ 
      error: 'Failed to update survey entry',
      details: error.message 
    });
  }
});

/**
 * @route   DELETE /api/survey/:id
 * @desc    Delete a survey entry (admin only)
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
      return res.status(403).json({ error: 'Only admin users can delete survey entries' });
    }

    // Check if survey entry exists
    const { data: survey, error: surveyError } = await supabase
      .from('survey_entries')
      .select('id')
      .eq('id', id)
      .single();

    if (surveyError || !survey) {
      return res.status(404).json({ error: 'Survey entry not found' });
    }

    // Delete related workflow nodes first
    await supabase
      .from('survey_workflow_nodes')
      .delete()
      .eq('survey_id', id);

    // Delete related assignments
    await supabase
      .from('survey_assignments')
      .delete()
      .eq('survey_id', id);

    // Delete related comments
    await supabase
      .from('survey_comments')
      .delete()
      .eq('survey_id', id);

    // Delete the survey entry
    const { error: deleteError } = await supabase
      .from('survey_entries')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting survey entry:', deleteError);
      return res.status(500).json({ error: 'Failed to delete survey entry' });
    }

    res.json({ message: 'Survey entry deleted successfully' });

  } catch (error) {
    console.error('Error in delete survey route:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Send workflow notifications via email
 */
async function sendWorkflowNotifications(surveyId, action, supabase, comment = '') {
  try {
    console.log(`=== SENDING SURVEY NOTIFICATIONS FOR ${action.toUpperCase()} ===`);
    console.log(`Survey ID: ${surveyId}`);

    // Get survey entry with all related data
    const { data: survey, error } = await supabase
      .from('survey_entries')
      .select(`
        *,
        survey_workflow_nodes(*),
        survey_assignments(*)
      `)
      .eq('id', surveyId)
      .single();

    if (error || !survey) {
      console.error('Failed to fetch survey for notifications:', error);
      return;
    }

    console.log('Survey data for notifications:', JSON.stringify(survey, null, 2));

    // Get current node
    const currentNode = survey.survey_workflow_nodes
      .find(node => node.node_order === survey.current_node_index);

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
      const currentNodeCCs = survey.survey_assignments.filter(assignment => 
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
      const nextNode = survey.survey_workflow_nodes
        .find(node => node.node_order === survey.current_node_index);

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
      const nextNodeCCs = survey.survey_assignments.filter(assignment => 
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
      const targetNode = survey.survey_workflow_nodes
        .find(node => node.node_order === survey.current_node_index);

      console.log('Target node:', targetNode);

      if (targetNode) {
        if (action === 'rejected') {
          // For rejection, notify admin (creator)
          const { data: creator, error: creatorError } = await supabase
            .from('users')
            .select('*')
            .eq('id', survey.created_by)
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
      const targetNodeCCs = survey.survey_assignments.filter(assignment => 
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
      await sendConsolidatedSurveyEmail(uniqueRecipients, survey, action, comment);
      
      // Create in-app notifications
      try {
        console.log('Creating in-app notifications for survey...');
        
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
            formType: 'survey',
            formId: survey.id,
            projectId: survey.project_id,
            projectName: survey.project,
            action,
            executorId,
            ccUserIds: [],
            comment
          });
        }
        
        // Create notifications for CC users
        for (const ccUserId of ccUserIds) {
          await createFormAssignmentNotifications(supabase, {
            formType: 'survey',
            formId: survey.id,
            projectId: survey.project_id,
            projectName: survey.project,
            action,
            executorId: null,
            ccUserIds: [ccUserId],
            comment
          });
        }
        
        console.log('In-app notifications created successfully for survey');
      } catch (notificationError) {
        console.error('Error creating in-app notifications for survey:', notificationError);
      }
    } else {
      console.log('No recipients found for survey notifications');
    }

    console.log('=== SURVEY NOTIFICATIONS PROCESSING COMPLETE ===');

  } catch (error) {
    console.error('=== SURVEY NOTIFICATION ERROR ===');
    console.error('Error sending workflow notifications:', error);
  }
}

/**
 * Send consolidated survey email to all recipients
 */
async function sendConsolidatedSurveyEmail(recipients, survey, action, comment = '') {
  try {
    console.log(`=== SENDING SURVEY EMAIL FOR ${action.toUpperCase()} ===`);
    console.log(`Recipients count: ${recipients.length}`);
    
    let subject = '';
    let message = '';
    const viewUrl = 'https://server.matrixtwin.com/survey';

    // Separate executors and CCs for personalized messaging
    const executors = recipients.filter(r => r.role_in_workflow === 'executor' || r.role_in_workflow === 'admin');
    const ccs = recipients.filter(r => r.role_in_workflow === 'cc');

    console.log(`Executors: ${executors.length}, CCs: ${ccs.length}`);
    console.log('Executor emails:', executors.map(e => e.email));
    console.log('CC emails:', ccs.map(c => c.email));

    switch (action) {
      case 'created':
        subject = `New Survey Check: ${survey.project} - Action Required`;
        message = `
Dear Team,

A new survey check has been created for project "${survey.project}" and requires attention.

Project: ${survey.project}
Date: ${survey.date}
Surveyor: ${survey.surveyor}
Contract No: ${survey.contract_no}
Location: ${survey.location}
Entry ID: ${survey.id}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and approve for "${e.node_name}"`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): You are CC'd on this survey check for "${c.node_name}"`).join('\n')}
` : ''}

Please log in to MatrixTwin to view and take action: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'approved':
        subject = `Survey Check Approved: ${survey.project} - Next Action Required`;
        message = `
Dear Team,

A survey check for project "${survey.project}" has been approved and moved to the next workflow step.

Project: ${survey.project}
Date: ${survey.date}
Entry ID: ${survey.id}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and approve for "${e.node_name}"`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): Survey has progressed to "${c.node_name}"`).join('\n')}
` : ''}

Please log in to MatrixTwin to view and take action: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'rejected':
        subject = `Survey Check Rejected: ${survey.project} - Admin Action Required`;
        message = `
Dear Team,

A survey check for project "${survey.project}" has been rejected and requires admin attention.

Project: ${survey.project}
Date: ${survey.date}
Entry ID: ${survey.id}

${comment ? `Rejection Reason: ${comment}` : ''}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review and resolve the issues`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): Survey has been rejected and needs revision`).join('\n')}
` : ''}

Please log in to MatrixTwin to review and resolve: ${viewUrl}

Best regards,
MatrixTwin Notification System
        `;
        break;

      case 'sent_back':
        subject = `Survey Check Sent Back: ${survey.project} - Review Required`;
        message = `
Dear Team,

A survey check for project "${survey.project}" has been sent back for review.

Project: ${survey.project}
Date: ${survey.date}
Entry ID: ${survey.id}

${comment ? `Comments: ${comment}` : ''}

${executors.length > 0 ? `
ACTION REQUIRED:
${executors.map(e => `• ${e.name} (${e.email}): Please review the comments and take action for "${e.node_name}"`).join('\n')}
` : ''}

${ccs.length > 0 ? `
FOR INFORMATION:
${ccs.map(c => `• ${c.name} (${c.email}): Survey has been sent back for review`).join('\n')}
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
    console.log(`Consolidated email sent successfully to ${allEmails.length} recipients for survey ${survey.id}`);

  } catch (error) {
    console.error('=== SURVEY EMAIL SENDING ERROR ===');
    console.error('Error sending consolidated survey email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
  }
}

module.exports = router; 