const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

router.get('/', (req, res) => {
  res.json({
    message: 'Test route is working!',
    time: new Date().toISOString()
  });
});

router.get('/protected', auth, (req, res) => {
  res.json({
    message: 'Protected route accessed successfully',
    user: req.user
  });
});

// Setup endpoint for testing
router.post('/setup', async (req, res) => {
    // This endpoint tries to set up data for testing.
    // It assumes the environment allows it (e.g. weak RLS or Service Role if available).
    const { userId, role, companyName } = req.body;
    const supabase = req.supabase; // This might be ANON client

    console.log(`[POST /setup] User: ${userId}, Role: ${role}, Company: ${companyName}`);

    try {
        let companyId;
        
        // 1. Try to find company
        const { data: existingCompany, error: findError } = await supabase
            .from('companies')
            .select('id')
            .eq('name', companyName)
            .maybeSingle();
            
        if (findError) console.error('Error finding company:', findError);
        
        if (existingCompany) {
            companyId = existingCompany.id;
            console.log(`Found existing company: ${companyId}`);
        } else {
            // 2. Create company
            const { data: newCompany, error: createError } = await supabase
                .from('companies')
                .insert({ name: companyName, details: { test: true } })
                .select()
                .single();
                
            if (createError) {
                console.error('Error creating company:', createError);
                return res.status(500).json({ error: createError });
            }
            companyId = newCompany.id;
            console.log(`Created new company: ${companyId}`);
        }

        // 3. Add member
        const { error: memberError } = await supabase
            .from('company_members')
            .upsert({
                company_id: companyId,
                user_id: userId,
                role: role
            }, { onConflict: 'company_id, user_id' }); // Assuming composite PK or constraint

        if (memberError) {
            console.error('Error adding member:', memberError);
            return res.status(500).json({ error: memberError });
        }
        
        console.log(`Added user ${userId} as ${role} to company ${companyId}`);
        res.json({ success: true, companyId });

    } catch (err) {
        console.error('Setup error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
