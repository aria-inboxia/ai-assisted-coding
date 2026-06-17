# Foyer core

## Background

Foyer is a small internal welcome screen. A person signs in and lands on a home
page that greets them and shows a welcome banner. This spec captures the core
behaviour that **already exists** in the app, so the acceptance suite and the
requirements-traceability gate have a verified baseline to build on.

## Requirements

- **R.1** — A person with valid credentials can sign in and reach the home page
- **R.2** — Invalid credentials are rejected with a visible error and no sign-in
- **R.3** — A signed-in person can sign out and is returned to the sign-in screen
- **R.4** — The home page shows the welcome banner with the default message
- **R.5** — The home page greets the signed-in person by the name derived from their email

## Out of scope

- Configuring the banner (covered by the configurable-banner feature).
- Real authentication or a backend — credentials are fixed demo logins.
