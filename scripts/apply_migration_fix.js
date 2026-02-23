
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');
require('dotenv').config();

const migrationFile = path.join(__dirname, '../supabase/migrations/20240524000001_fix_admin_company_members.sql');

async function applyMigration() {
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL is not set in environment variables.');
    console.log('Please ensure your .env file contains DATABASE_URL.');
    process.exit(1);
  }

  console.log('Connecting to database...');
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false } // Required for Supabase in many environments
  });

  try {
    console.log(`Reading migration file: ${migrationFile}`);
    const migrationSql = fs.readFileSync(migrationFile, 'utf8');

    console.log('Executing migration...');
    // Split by semicolon if needed, but postgres library can handle multiple statements usually?
    // postgres.js `file` method is good for files, but here we read content.
    // simple template literal works for multiple statements in postgres.js? 
    // Usually yes.
    
    await sql.unsafe(migrationSql);
    
    console.log('Migration applied successfully!');
  } catch (err) {
    console.error('Error applying migration:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

applyMigration();
