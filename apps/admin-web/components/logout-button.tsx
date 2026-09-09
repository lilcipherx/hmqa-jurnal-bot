'use client';

export function LogoutButton({ label }: { label: string }) {
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }
  return (
    <button className="button secondary" type="button" onClick={() => void logout()}>
      {label}
    </button>
  );
}
