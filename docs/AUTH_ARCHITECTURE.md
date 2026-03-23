# Petroleum Auth Architecture

## Goal

Add OAuth-based login for jobber-specific users while keeping the existing seeded demo login functional during rollout.

## Current Foundation

The API now supports:

- `jobbers`: tenant records for each jobber/customer
- `user_jobber_roles`: per-jobber role membership
- `sites.jobber_id`: site ownership by jobber
- OAuth identity fields on `users`:
  - `oauth_provider`
  - `oauth_subject`
  - `last_login_at`

The legacy `users.role` and password login are still present so current demo users and existing UI flows keep working.

## Target Role Model

- `admin`
  - full access within a single jobber
  - manage jobber users and jobber settings
- `manager`
  - operational access within a single jobber
  - view and work with assigned sites and data

Future platform-wide internal access should be a separate concept, for example `platform_admin`, not a jobber role.

## Recommended OAuth Flow

1. User clicks `Sign in with Google` or `Sign in with Microsoft` in `apps/web`.
2. Web app redirects to an API route such as `/auth/oauth/:provider/start`.
3. API completes OAuth callback on `/auth/oauth/:provider/callback`.
4. API finds or creates the `users` row using `(oauth_provider, oauth_subject)`.
5. API loads `user_jobber_roles` memberships and selects the default jobber membership.
6. API returns a secure session or signed token with:
   - `userId`
   - `orgId`
   - `jobberId`
   - `jobberRole`
   - `siteIds`
7. Every protected API route enforces jobber and site scope server-side.

## Suggested Next Implementation Steps

1. Add OAuth provider configuration env vars in Render for API and web.
2. Implement `/auth/oauth/:provider/start` and `/auth/oauth/:provider/callback`.
3. Add a small login screen in `apps/web` instead of auto-login.
4. Add admin APIs for inviting or provisioning users into `user_jobber_roles`.
5. Tighten site queries so all tenant-scoped reads include `jobber_id`.

## Current API OAuth Endpoints

- `GET /auth/oauth/providers`
  - returns enabled provider status
- `GET /auth/oauth/google/start`
  - begins Google OAuth redirect
- `GET /auth/oauth/google/callback`
  - exchanges the code, provisions or links the user, and redirects back to the web app with a token in the URL hash

Current provisioning rules:

- If `(oauth_provider, oauth_subject)` already matches a user, that user is reused.
- Else if email matches an existing user, the OAuth identity is linked to that user.
- Else if the email domain matches `jobbers.oauth_domain`, a new user is created and assigned that jobber with role `manager`.
- Else login is rejected.

This is sufficient for initial rollout, but long term user creation should move to an explicit invite flow controlled by a jobber admin.

## Render Environment Variables

API service:

- `DATABASE_URL`
- `PGSSL`
- `WEB_BASE_URL`
- `SESSION_SECRET` or `JWT_SECRET`
- `OAUTH_GOOGLE_CLIENT_ID`
- `OAUTH_GOOGLE_CLIENT_SECRET`
- `OAUTH_GOOGLE_CALLBACK_URL`

Web service:

- `VITE_API_BASE_URL`
- `VITE_GOOGLE_CLIENT_ID` only if the frontend initiates provider-specific flows directly

## Rollout Note

Keep demo password login until OAuth login and jobber user provisioning are fully tested in Render. Remove the password path only after at least one real jobber can sign in and access only its own locations.
