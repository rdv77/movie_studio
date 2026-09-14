import { redirect } from 'next/navigation';
import { getAuthConfig } from '@/lib/auth';
import { currentOwner } from '../auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentOwner()) redirect('/');
  const config = getAuthConfig();
  const params = await searchParams;
  const fieldStyle = { width: '100%', marginTop: 8, padding: '12px 14px', background: '#101213', border: '1px solid #394143', borderRadius: 8, color: '#edf0ed' };
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <section style={{ width: '100%', maxWidth: 430, padding: '36px 30px', background: '#181b1d', border: '1px solid #303638', borderRadius: 16, boxShadow: '0 24px 90px #0005' }}>
        <div style={{ fontSize: 30, fontWeight: 750, letterSpacing: 3 }}>КАДР<span style={{ color: '#d6fa76' }}>.</span></div>
        <p style={{ color: '#8f9994', margin: '8px 0 30px', fontSize: 13 }}>РЕЖИССЁРСКАЯ СТУДИЯ</p>
        <h1 style={{ fontSize: 22, fontWeight: 650, marginBottom: 10 }}>Вход в студию</h1>
        <p style={{ color: '#aeb8b1', lineHeight: 1.6, marginBottom: 24 }}>Ваши проекты, сценарии и материалы фильма.</p>
        {!config ? (
          <p role="alert" style={{ color: '#ffb5af', lineHeight: 1.6 }}>Вход пока не настроен. Владелец сервера должен завершить настройку доступа по инструкции в README.</p>
        ) : (
          <form action="/api/auth/login" method="post" style={{ display: 'grid', gap: 20 }}>
            {params.error === 'credentials' && <p role="alert" style={{ color: '#ffb5af', margin: 0 }}>Неверное имя пользователя или пароль.</p>}
            <label style={{ fontSize: 14 }}>Имя пользователя
              <input style={fieldStyle} name="username" type="text" autoComplete="username" maxLength={128} required autoFocus />
            </label>
            <label style={{ fontSize: 14 }}>Пароль
              <input style={fieldStyle} name="password" type="password" autoComplete="current-password" maxLength={1024} required />
            </label>
            <button type="submit" style={{ padding: '13px 18px', border: 0, borderRadius: 8, color: '#1b2411', background: '#d6fa76', fontWeight: 700, marginTop: 4 }}>Войти</button>
          </form>
        )}
      </section>
    </main>
  );
}
