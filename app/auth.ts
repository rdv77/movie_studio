import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticateRequest } from '@/lib/auth';

export async function currentOwner(): Promise<'owner' | null> {
  const requestHeaders = await headers();
  return authenticateRequest(new Request('http://localhost/', { headers: requestHeaders }));
}

export async function requireOwner(): Promise<'owner'> {
  const owner = await currentOwner();
  if (!owner) redirect('/login');
  return owner;
}
