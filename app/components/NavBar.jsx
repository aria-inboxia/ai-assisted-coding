export function NavBar({ session, onSignOut }) {
  return (
    <header className="navbar">
      <div className="navbar__brand">Foyer</div>
      <nav className="navbar__nav" aria-label="Primary">
        <span className="navbar__user">{session.email}</span>
        <span className="navbar__role">{session.role}</span>
        <button type="button" className="navbar__action" onClick={onSignOut}>
          Sign out
        </button>
      </nav>
    </header>
  );
}
