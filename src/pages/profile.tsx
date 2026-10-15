import { type FormEvent, useState } from 'react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { KeyRound, Save, UserRound } from 'lucide-react';
import { authClient, ProtectedRoute, useSession } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { account_profile } from 'virtual:content';

const fieldClass = 'mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-secondary outline-none focus:border-primary focus:ring-2 focus:ring-ring';

function AccountProfileContent() {
  const { user } = useSession();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setNotice('');
    setError('');
    setSavingProfile(true);
    const { error: updateError } = await authClient.updateUser({ name: String(form.get('name') || '').trim() });
    if (updateError) setError(updateError.message || 'Unable to update your account profile.');
    else setNotice(account_profile.notices.profileSaved);
    setSavingProfile(false);
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get('newPassword') || '');
    const confirmation = String(form.get('confirmPassword') || '');
    setNotice('');
    setError('');
    if (newPassword !== confirmation) {
      setError('Your new password and confirmation must match.');
      return;
    }
    setSavingPassword(true);
    const { error: passwordError } = await authClient.changePassword({
      currentPassword: String(form.get('currentPassword') || ''),
      newPassword,
      revokeOtherSessions: true,
    });
    if (passwordError) setError(passwordError.message || 'Unable to update your password.');
    else {
      setNotice(account_profile.notices.passwordSaved);
      event.currentTarget.reset();
    }
    setSavingPassword(false);
  }

  return <WorkspaceLayout><div className="mx-auto grid max-w-3xl gap-xl"><section><p className="text-sm font-bold text-primary">Connection Pilot account</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-secondary">{account_profile.hero.title}</h1><p className="mt-2 max-w-2xl leading-7 text-muted-foreground">{account_profile.hero.description}</p></section><section className="rounded-3xl border border-border bg-card p-base sm:p-xl"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-primary"><UserRound size={20} /></span><div><h2 className="text-xl font-extrabold text-secondary">Owner details</h2><p className="text-sm text-muted-foreground">Your sign-in email is managed by your Connection Pilot account.</p></div></div><form onSubmit={saveProfile} className="mt-lg grid gap-base"><label className="text-sm font-bold text-secondary">{account_profile.fields.name}<input name="name" required defaultValue={user?.name || ''} className={fieldClass} /></label><label className="text-sm font-bold text-secondary">{account_profile.fields.email}<input readOnly value={user?.email || ''} className={`${fieldClass} cursor-not-allowed bg-muted`} /></label><button disabled={savingProfile} className="inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary active:scale-95 disabled:opacity-60"><Save size={16} />{savingProfile ? 'Saving...' : account_profile.actions.saveProfile}</button></form></section><section className="rounded-3xl border border-border bg-card p-base sm:p-xl"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-primary"><KeyRound size={20} /></span><div><h2 className="text-xl font-extrabold text-secondary">Account security</h2><p className="text-sm text-muted-foreground">Changing your password signs out other active sessions.</p></div></div><form onSubmit={changePassword} className="mt-lg grid gap-base"><label className="text-sm font-bold text-secondary">{account_profile.fields.currentPassword}<input required type="password" name="currentPassword" autoComplete="current-password" className={fieldClass} /></label><label className="text-sm font-bold text-secondary">{account_profile.fields.newPassword}<input required minLength={8} type="password" name="newPassword" autoComplete="new-password" className={fieldClass} /></label><label className="text-sm font-bold text-secondary">{account_profile.fields.confirmPassword}<input required minLength={8} type="password" name="confirmPassword" autoComplete="new-password" className={fieldClass} /></label><button disabled={savingPassword} className="inline-flex w-fit items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-bold text-secondary transition-colors hover:bg-accent active:scale-95 disabled:opacity-60"><KeyRound size={16} />{savingPassword ? 'Updating...' : account_profile.actions.changePassword}</button></form></section>{error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}{notice && <p role="status" className="rounded-xl border border-primary bg-accent p-4 text-sm font-bold text-secondary">{notice}</p>}</div></WorkspaceLayout>;
}

export default function ProfilePage() {
  return <><Helmet><title>{account_profile.meta.title}</title><meta name="description" content={account_profile.meta.description} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><AccountProfileContent /></ProtectedRoute></>;
}
