# BuildSphere API Server

This is the backend API server for the BuildSphere application. It provides RESTful API endpoints for authentication, project management, form handling, and user profiles.

## Tech Stack

- Node.js
- Express
- Supabase (PostgreSQL)
- JWT for authentication

## Setup

1. Clone the repository
2. Install dependencies

```bash
npm install
```

3. Set up environment variables by creating a `.env` file with the following variables:

```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
JWT_SECRET=your_jwt_secret
PORT=5000
NODE_ENV=development
EMAIL_CONFIRM_REDIRECT_URL=your_email_confirmation_redirect_url
PASSWORD_RESET_REDIRECT_URL=your_password_reset_redirect_url
```

4. Start the development server

```bash
npm run dev
```

## Supabase Configuration

### Authentication Setup

The application uses Supabase Authentication for user management, which requires proper setup:

1. Set up Supabase project and enable email authentication
2. Configure custom SMTP settings in Supabase Auth settings:
   - Set sender email and name
   - Configure SMTP provider settings (host, port, username, password)
   - Set minimum interval between emails (recommended: 60 seconds)

### Email Rate Limiting

Supabase imposes rate limits on email operations. With custom SMTP configured:

- Email sending is limited by the minimum interval you set (e.g., 60 seconds between emails)
- Token refreshes are limited to 30 per IP address per 5 minutes
- Password reset requests are limited to prevent abuse

The application handles these rate limits by:
- Providing appropriate error messages with retry-after information
- Implementing server-side throttling for password reset requests
- Gracefully handling rate limit errors in signup and password reset flows

## API Endpoints

### Authentication

- `POST /api/auth/signup` - Register a new user
- `POST /api/auth/login` - Login a user
- `POST /api/auth/verify-2fa` - Verify 2FA code
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token
- `GET /api/auth/me` - Get current user

### Projects

- `GET /api/projects` - Get all projects
- `GET /api/projects/:id` - Get project by ID
- `POST /api/projects` - Create a new project
- `PUT /api/projects/:id` - Update a project
- `DELETE /api/projects/:id` - Delete a project
- `POST /api/projects/:id/workers` - Add worker to project
- `DELETE /api/projects/:id/workers/:userId` - Remove worker from project
- `POST /api/projects/:id/apply` - Apply to join a project
- `GET /api/projects/:id/applications` - Get applications for a project
- `PUT /api/projects/:id/applications/:applicationId` - Approve/reject application

### Forms

- `GET /api/forms` - Get all forms
- `GET /api/forms/:id` - Get form by ID
- `POST /api/forms` - Create a new form
- `PUT /api/forms/:id` - Update a form
- `DELETE /api/forms/:id` - Delete a form
- `POST /api/forms/:id/submissions` - Submit a form response
- `GET /api/forms/:id/submissions` - Get form submissions
- `GET /api/forms/templates` - Get form templates

### Profiles

- `GET /api/profiles` - Get all user profiles (admin only)
- `GET /api/profiles/me` - Get current user's profile
- `GET /api/profiles/:id` - Get user profile by ID
- `PUT /api/profiles/me` - Update current user's profile
- `PUT /api/profiles/:id` - Update a user profile (admin only)
- `GET /api/profiles/skills` - Get all skill categories and skills
- `GET /api/profiles/me/skills` - Get current user's skills
- `POST /api/profiles/me/skills` - Add a skill to current user
- `PUT /api/profiles/me/skills/:skillId` - Update user's skill rating
- `DELETE /api/profiles/me/skills/:skillId` - Remove a skill from user
- `PUT /api/profiles/:userId/skills/:skillId/verify` - Verify a user's skill

## Database Schema

The application uses Supabase (PostgreSQL) with the following tables:

- `users` - User accounts
- `projects` - Construction projects
- `project_managers` - Mapping of project managers to projects
- `project_workers` - Mapping of workers to projects
- `project_applications` - Applications from workers to join projects
- `forms` - Form templates and assignments
- `form_submissions` - Submitted form data
- `form_templates` - Reusable form templates
- `skill_categories` - Categories of worker skills
- `skills` - Specific skills within categories
- `user_skills` - Skills possessed by users

## Deployment to Alibaba Cloud

This API is configured for deployment on Alibaba Cloud Function Compute:

1. Make sure you have the Serverless CLI (S) installed and configured:

```bash
# Install if not already installed
npm install -g @serverless-devs/s

# Configure access credentials
s config add
```

2. Login and configure your Alibaba Cloud credentials in the interactive setup.

3. Deploy to Alibaba Cloud:

```bash
s deploy
```

4. For production deployment with custom domain:

```bash
s deploy --use-local
```

5. Set up environment variables in the s.yaml file or Alibaba Cloud console:
   - `SUPABASE_URL`
   - `SUPABASE_KEY` 
   - `JWT_SECRET`
   - `DASHSCOPE_API_KEY`
   - `DASHSCOPE_APP_ID`

6. After deployment, you'll get a Function Compute URL that you can use to access your API.

## License

MIT # MatrixTwin_server
