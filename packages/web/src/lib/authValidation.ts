export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

export function validateSignup(email: string, password: string, confirm: string): string | null {
  if (!email.trim()) return 'Enter your email.';
  const pw = validatePassword(password);
  if (pw) return pw;
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}
