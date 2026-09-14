import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Кадр — режиссерская студия',
  description: 'Анимационный фильм от сценария до монтажа: варианты, утверждения и прозрачные расходы.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark">
      <body
        className="antialiased"
      >
        {children}
      </body>
    </html>
  );
}
