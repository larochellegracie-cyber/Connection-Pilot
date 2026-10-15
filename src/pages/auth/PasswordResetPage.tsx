import { FormEvent, useState } from 'react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { Link, useLocation, useNavigate } from 'react-router';
import { authClient } from '@/lib/auth/auth-client';
import { password_reset } from 'virtual:content';

const fieldClass = 'mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-secondary outline-none focus:border-primary focus:ring-2 focus:ring-primary';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus('');
    try {
      await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
      setStatus(password_reset.forgot.sent);
    } finally {
      setLoading(false);
    }
  }

  return <main className="bg-muted py-xxl"><Helmet><title>{password_reset.forgot.seo.title}</title><meta name="description" content={password_reset.forgot.seo.description} /><link rel="canonical" href="https://connectionpilot.net/forgot-password" /><meta name="robots" content="noindex, nofollow" /></Helmet><section className="mx-auto max-w-md px-5"><div className="rounded-3xl border border-border bg-card p-xl shadow-xl"><h1 className="text-3xl font-extrabold text-secondary">{password_reset.forgot.title}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{password_reset.forgot.description}</p><form onSubmit={submit} className="mt-xl"><label className="text-sm font-bold text-secondary">{password_reset.forgot.emailLabel}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={fieldClass} autoComplete="email" /></label><button disabled={loading} className="mt-lg w-full rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">{password_reset.forgot.submit}</button></form>{status && <p role="status" className="mt-base rounded-xl border border-primary bg-accent p-4 text-sm font-bold text-secondary">{status}</p>}<Link to="/login" className="mt-lg inline-block text-sm font-bold text-primary hover:text-secondary">{password_reset.forgot.back}</Link></div></section></main>;
}

export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const token = new URLSearchParams(location.search).get('token');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || password.length < 8 || password !== confirmPassword) {
      setError(password_reset.reset.invalid);
      return;
    }
    setLoading(true);
    setError('');
    const result = await authClient.resetPassword({ newPassword: password, token });
    if (result.error) {
      setError(password_reset.reset.invalid);
      setLoading(false);
      return;
    }
    navigate('/login', { replace: true });
  }

  return <main className="bg-muted py-xxl"><Helmet><title>{password_reset.reset.seo.title}</title><meta name="description" content={password_reset.reset.seo.description} /><link rel="canonical" href="https://connectionpilot.net/reset-password" /><meta name="robots" content="noindex, nofollow" /></Helmet><section className="mx-auto max-w-md px-5"><div className="rounded-3xl border border-border bg-card p-xl shadow-xl"><h1 className="text-3xl font-extrabold text-secondary">{password_reset.reset.title}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{password_reset.reset.description}</p><form onSubmit={submit} className="mt-xl grid gap-base"><label className="text-sm font-bold text-secondary">{password_reset.reset.passwordLabel}<input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className={fieldClass} autoComplete="new-password" /></label><label className="text-sm font-bold text-secondary">{password_reset.reset.confirmLabel}<input required type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className={fieldClass} autoComplete="new-password" /></label><button disabled={loading} className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">{password_reset.reset.submit}</button></form>{error && <p role="alert" className="mt-base rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}</div></section></main>;
}
