# Obsidian Elite Tournament Manager

A robust, full-stack Next.js application designed to manage high-traffic football tournaments. Built for scalability to handle millions of concurrent users with edge caching and Supabase integration.

## Features

- **Public Hub**: View scheduled fixtures and real-time match events.
- **Admin Dashboard**: Secure, role-based access for entering match fixtures and logging live match events (goals, red cards, corners, substitutions, etc.).
- **Authentication**: Secure Google and Email/Password sign-in powered by Supabase Auth.
- **Highly Scalable**: Prepared for edge caching, connection pooling, and CDN delivery to handle massive spikes in traffic.

---

## Deployment Guide (Vercel & Supabase)

Since this codebase is hosted entirely on GitHub, deploying it to Vercel is the most seamless and secure approach. **Do not commit actual `.env` files to GitHub.**

### 1. Set Up the Database (Supabase)

1. Create a new project at [Supabase](https://supabase.com/dashboard).
2. Go to **Project Settings** (gear icon) -> **API**.
3. Keep this tab open; you will need the **Project URL** and the **anon public API Key** for Vercel.
4. Go to the **SQL Editor** (terminal icon on the left).
5. Open the `supabase/schema.sql` file from this GitHub repository, copy its contents, and paste it into the Supabase SQL Editor.
6. Click **Run**. This instantly provisions your tables (`teams`, `fixtures`, `match_events`, `user_roles`) and sets up Row Level Security (RLS).
7. *Optional but recommended:* Set up Supabase Auth rate limiting in **Authentication -> Rate Limits** to protect against sign-in spam.

### 2. Deploy to Vercel

1. Log in to [Vercel](https://vercel.com/) and click **Add New... -> Project**.
2. Import your GitHub repository containing this codebase.
3. Vercel will automatically detect that this is a Next.js project. Leave the Build and Output Settings as their defaults.
4. Expand the **Environment Variables** section. Add the following two variables using the credentials from your Supabase API settings:
   - Name: `NEXT_PUBLIC_SUPABASE_URL` | Value: *(Your Supabase Project URL)*
   - Name: `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Value: *(Your Supabase anon key)*
5. Click **Deploy**. Vercel will build the application and securely inject your database keys.

### 3. Creating Your First Admin User

By default, anyone who signs up is a standard user. To grant yourself admin access to the dashboard:

1. Visit your live Vercel site and create an account via the Sign In page.
2. Go back to your Supabase Dashboard -> **Authentication** -> **Users**. Find your user ID (UUID).
3. Go to the **Table Editor** -> `user_roles` table.
4. Insert a new row:
   - `user_id`: *(Paste your UUID)*
   - `role`: `admin`
5. Refresh your live site. You will now see the "Go to Admin Dashboard" button and have write access to create fixtures.

---

## Local Development (Optional)

If you ever decide to pull the code down to your local machine to test changes:

1. Clone the repository.
2. Run `npm install`.
3. Copy the `.env.example` file to a new file named `.env.local` and fill in your Supabase credentials. **(Ensure `.env.local` remains ignored by git).**
4. Run `npm run dev` to start the local server on `http://localhost:3000`.

## Architecture & Security

For detailed information on how this application is architected to handle 3 million concurrent users, please read the [`SECURITY_AND_SCALING.md`](./SECURITY_AND_SCALING.md) file included in this repository.

### 4. Enable Google Authentication

To allow users to sign in with their Google accounts, you need to link Google Cloud and Supabase.

**Part 1: Give Supabase's link to Google**
1. Go to your **Supabase Dashboard** > **Authentication** > **URL Configuration**.
2. Scroll down to **Callback (for OAuth)**. It looks like `https://[YOUR_PROJECT_ID].supabase.co/auth/v1/callback`. **Copy this link.**
3. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project.
4. Navigate to **APIs & Services > Credentials** and click **Create Credentials -> OAuth client ID** (Web application).
5. Under **Authorized redirect URIs**, click "Add URI" and **paste the link you copied from Supabase**.
6. Save it to generate your **Client ID** and **Client Secret**.

**Part 2: Give Google's keys to Supabase**
1. Go back to your **Supabase Dashboard** > **Authentication** > **Providers**.
2. Click on **Google** and toggle it **ON**.
3. Paste the **Client ID** and **Client Secret** that Google just generated.
4. Click Save.

**Part 3: Tell Supabase about your Vercel Website**
1. In **Supabase**, go back to **Authentication** > **URL Configuration**.
2. Under **Site URL**, paste your main Vercel website link (e.g., `https://obsidian-elite.vercel.app`).
3. Under **Redirect URLs**, click "Add URL", paste your Vercel link again, but add `/**` to the end of it (e.g., `https://obsidian-elite.vercel.app/**`).
